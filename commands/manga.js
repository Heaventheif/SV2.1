"use strict";

/**
 * أمر: manga
 * الاستخدام: manga <اسم المانجا> <رقم الفصل> [لغة اختيارية: ar/en/ja]
 * مثال:      manga one piece 13
 *            manga one piece 13 en
 *
 * يبحث في MangaDex عن المانجا، يحدد أفضل نتيجة مطابقة، يجلب الفصل
 * المطلوب (بأولوية لغة عربي > إنجليزي > ياباني > أي لغة متاحة)،
 * ثم يرسل جميع صفحاته كصور دفعات (10 لكل دفعة).
 */

const axios   = require("axios");
const fs      = require("fs-extra");
const os      = require("os");
const path    = require("path");
const cache   = require("../utils/cache.js");

const API_BASE       = "https://api.mangadex.org";
const MAX_PER_GROUP  = 10;               // حد الصور لكل دفعة إرسال
const SEARCH_TTL     = 30 * 60 * 1000;   // 30 دقيقة
const AGGREGATE_TTL  = 10 * 60 * 1000;   // 10 دقائق
const MIN_MATCH_SCORE = 0.60;            // أدنى نسبة تشابه مقبولة

// أولوية اللغات عند عدم تحديد المستخدم للغة
const LANG_PRIORITY = ["ar", "en", "ja"];

// اختصارات لغة قد يكتبها المستخدم في نهاية الأمر
const LANG_ALIASES = {
  ar: "ar", arabic: "ar", عربي: "ar", عربية: "ar",
  en: "en", eng: "en", english: "en", انجليزي: "en", إنجليزي: "en",
  ja: "ja", jp: "ja", japanese: "ja", ياباني: "ja",
};

const LANG_LABELS = { ar: "العربية", en: "الإنجليزية", ja: "اليابانية" };

const HEADERS = { "User-Agent": "SunkenBot/2.0 (manga command)" };

// ─── أدوات مساعدة عامة ─────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// تحويل نص إلى ثنائيات حروف (bigrams) لحساب التشابه
function bigrams(str) {
  const s = str.toLowerCase().replace(/\s+/g, " ").trim();
  const out = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.substring(i, i + 2));
  return out;
}

// نسبة تشابه (Dice's Coefficient) بين نصين — بديل مبسّط لمكتبة string-similarity
function similarity(a, b) {
  if (!a || !b) return 0;
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (na === nb) return 1;
  const bgA = bigrams(na);
  const bgB = bigrams(nb);
  if (!bgA.length || !bgB.length) return 0;
  const mapB = new Map();
  for (const bg of bgB) mapB.set(bg, (mapB.get(bg) || 0) + 1);
  let matches = 0;
  for (const bg of bgA) {
    const count = mapB.get(bg) || 0;
    if (count > 0) {
      matches++;
      mapB.set(bg, count - 1);
    }
  }
  return (2 * matches) / (bgA.length + bgB.length);
}

// تنظيف اسم المانجا المُدخل من المستخدم
function cleanQuery(raw) {
  return raw
    .replace(/["'`ʼ’]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// جلب كل عناوين المانجا (الرئيسي + البدائل) كمصفوفة نصوص
function collectTitles(manga) {
  const titles = [];
  const attrs = manga.attributes || {};
  if (attrs.title) titles.push(...Object.values(attrs.title));
  if (Array.isArray(attrs.altTitles)) {
    for (const alt of attrs.altTitles) titles.push(...Object.values(alt));
  }
  return titles.filter(Boolean);
}

function bestTitle(manga) {
  const attrs = manga.attributes || {};
  return (
    attrs.title?.en ||
    attrs.title?.ja ||
    Object.values(attrs.title || {})[0] ||
    "بدون عنوان"
  );
}

// ─── المرحلة الرابعة/الخامسة/السادسة: البحث واختيار أفضل نتيجة ───

async function searchManga(query) {
  const cacheKey = `manga_search:${query}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const res = await axios.get(`${API_BASE}/manga`, {
    params: {
      title: query,
      limit: 20,
      "order[relevance]": "desc",
      "contentRating[]": ["safe", "suggestive", "erotica"],
    },
    headers: HEADERS,
    timeout: 15000,
  });

  const results = res.data?.data || [];
  cache.set(cacheKey, results, SEARCH_TTL);
  return results;
}

function pickBestManga(query, candidates) {
  let best = null;
  let bestScore = 0;
  for (const manga of candidates) {
    const titles = collectTitles(manga);
    let score = 0;
    for (const t of titles) score = Math.max(score, similarity(query, cleanQuery(t)));
    if (score > bestScore) {
      bestScore = score;
      best = manga;
    }
  }
  return { manga: best, score: bestScore };
}

// ─── المرحلة السابعة/الثامنة: جلب الفصول واختيار الفصل المطلوب ───

async function fetchAggregate(mangaId, lang) {
  const cacheKey = `manga_aggregate:${mangaId}:${lang || "all"}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const params = {};
  if (lang) params["translatedLanguage[]"] = [lang];

  const res = await axios.get(`${API_BASE}/manga/${mangaId}/aggregate`, {
    params,
    headers: HEADERS,
    timeout: 15000,
  });

  const volumes = res.data?.volumes || {};
  cache.set(cacheKey, volumes, AGGREGATE_TTL);
  return volumes;
}

// يبحث في مخطط aggregate عن مدخل الفصل بأولوية: 13 → 13.0 → 13.x → أخرى
function findChapterEntry(volumes, chapterNumber) {
  const entries = [];
  for (const vol of Object.values(volumes)) {
    for (const ch of Object.values(vol.chapters || {})) entries.push(ch);
  }
  if (!entries.length) return null;

  const target = String(chapterNumber);
  const targetNum = Number(chapterNumber);

  // 1) تطابق تام للنص
  let found = entries.find((e) => e.chapter === target);
  if (found) return found;

  // 2) صيغة "13.0"
  found = entries.find((e) => Number(e.chapter) === targetNum && e.chapter.includes("."));
  if (found) return found;

  // 3) فصول فرعية مثل "13.5"، "13.1" (أقرب رقم للفصل المطلوب)
  const decimals = entries
    .filter((e) => {
      const n = parseFloat(e.chapter);
      return !isNaN(n) && Math.floor(n) === targetNum && n !== targetNum;
    })
    .sort((a, b) => parseFloat(a.chapter) - parseFloat(b.chapter));
  if (decimals.length) return decimals[0];

  // 4) أي مطابقة نصية تحتوي الرقم (مثل فصول خاصة/Extra)
  found = entries.find((e) => e.chapter && e.chapter.includes(target));
  if (found) return found;

  return null;
}

// يجلب لغة فصل معيّن عبر معرفه
async function getChapterLanguage(chapterId) {
  const res = await axios.get(`${API_BASE}/chapter/${chapterId}`, {
    headers: HEADERS,
    timeout: 15000,
  });
  return res.data?.data?.attributes?.translatedLanguage;
}

// يختار أفضل نسخة لغة من بين (id الرئيسي + others) حسب الأولوية المطلوبة
async function resolveLanguageVariant(entry, requestedLang) {
  const candidateIds = [entry.id, ...(entry.others || [])];
  const langMap = {}; // lang -> chapterId

  for (const id of candidateIds) {
    try {
      const lang = await getChapterLanguage(id);
      if (lang && !langMap[lang]) langMap[lang] = id;
    } catch (_) {
      /* تجاهل معرف فشل جلبه، جرّب التالي */
    }
  }

  const availableLangs = Object.keys(langMap);
  if (!availableLangs.length) return { chapterId: null, availableLangs: [] };

  if (requestedLang) {
    if (langMap[requestedLang]) {
      return { chapterId: langMap[requestedLang], lang: requestedLang, availableLangs };
    }
    return { chapterId: null, availableLangs };
  }

  for (const lang of LANG_PRIORITY) {
    if (langMap[lang]) return { chapterId: langMap[lang], lang, availableLangs };
  }
  // أي لغة متوفرة كخيار أخير
  const anyLang = availableLangs[0];
  return { chapterId: langMap[anyLang], lang: anyLang, availableLangs };
}

// ─── المرحلة الحادية عشر/الثانية عشر: At-Home Server وبناء الروابط ───

async function buildPageUrls(chapterId) {
  const res = await axios.get(`${API_BASE}/at-home/server/${chapterId}`, {
    headers: HEADERS,
    timeout: 15000,
  });

  const baseUrl = res.data?.baseUrl;
  const chapter = res.data?.chapter;
  if (!baseUrl || !chapter?.hash || !Array.isArray(chapter.data)) return [];

  return chapter.data.map((file) => `${baseUrl}/data/${chapter.hash}/${file}`);
}

// ─── المرحلة الرابعة عشر: تحميل وإرسال الصور على دفعات ───

async function downloadImage(url, index) {
  const ext = path.extname(url).split("?")[0] || ".jpg";
  const filePath = path.join(os.tmpdir(), `manga_${Date.now()}_${index}${ext}`);
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 20000,
    headers: HEADERS,
  });
  await fs.writeFile(filePath, res.data);
  return filePath;
}

module.exports = {
  config: {
    name: "manga",
    aliases: ["مانجا"],
    version: "1.0.0",
    author: "Sunken",
    countDown: 15,
    role: 0,
    shortDescription: { ar: "قراءة فصول المانجا (صور)" },
    category: "media",
    guide: {
      ar:
        "{pn}manga [اسم المانجا] [رقم الفصل] [لغة اختيارية]\n" +
        "أمثلة:\n" +
        "  {pn}manga one piece 13\n" +
        "  {pn}manga one piece 13 en\n" +
        "  {pn}manga attack on titan 5 ar",
    },
  },

  onStart: async function ({ api, event, args }) {
    const { threadID, messageID } = event;

    // ─── المرحلة الثانية: تحليل الأمر ───
    if (!args.length) {
      return global.safeSend(
        api,
        "📖 قارئ المانجا\n\n" +
          "📝 الاستخدام: manga [اسم المانجا] [رقم الفصل]\n\n" +
          "💡 مثال:\n  manga one piece 13\n  manga one piece 13 en",
        threadID,
        null,
        messageID
      );
    }

    // استخراج لغة اختيارية من آخر كلمة (ar/en/ja...)
    let workingArgs = [...args];
    let requestedLang = null;
    if (workingArgs.length >= 3) {
      const maybeLang = LANG_ALIASES[workingArgs[workingArgs.length - 1].toLowerCase()];
      if (maybeLang) {
        requestedLang = maybeLang;
        workingArgs = workingArgs.slice(0, -1);
      }
    }

    const lastToken = workingArgs[workingArgs.length - 1];
    const isChapterNumber = lastToken && /^\d+(\.\d+)?$/.test(lastToken);

    if (!isChapterNumber) {
      return global.safeSend(api, "❗ يرجى تحديد رقم الفصل.", threadID, null, messageID);
    }

    const chapterNumber = lastToken;
    const rawName = workingArgs.slice(0, -1).join(" ").trim();

    if (!rawName) {
      return global.safeSend(
        api,
        "📖 قارئ المانجا\n\n" +
          "📝 الاستخدام: manga [اسم المانجا] [رقم الفصل]\n\n" +
          "💡 مثال:\n  manga one piece 13",
        threadID,
        null,
        messageID
      );
    }

    // ─── المرحلة الثالثة: تنظيف البيانات ───
    const mangaQuery = cleanQuery(rawName);
    if (!mangaQuery) {
      return global.safeSend(api, "❗ يرجى تحديد رقم الفصل.", threadID, null, messageID);
    }

    let statusMsgId = null;
    try {
      const sent = await global.safeSend(
        api,
        `⏳ جاري البحث عن المانجا...\n📖 ${rawName}\n📄 الفصل ${chapterNumber}`,
        threadID,
        null,
        messageID
      );
      statusMsgId = sent?.messageID;
    } catch (_) {}

    const updateStatus = async (text) => {
      try {
        if (statusMsgId) await api.editMessage(text, statusMsgId);
      } catch (_) {}
    };

    try {
      // ─── المرحلة الرابعة/الخامسة/السادسة ───
      let candidates;
      try {
        candidates = await searchManga(mangaQuery);
      } catch (err) {
        throw { userMsg: "❌ تعذر الاتصال بخادم المانجا.\nحاول لاحقاً." };
      }

      if (!candidates.length) {
        throw { userMsg: "❌ لم يتم العثور على مانجا بهذا الاسم." };
      }

      const { manga, score } = pickBestManga(mangaQuery, candidates);
      if (!manga || score < MIN_MATCH_SCORE) {
        throw { userMsg: "❌ لم أتمكن من العثور على المانجا." };
      }

      const mangaId = manga.id;
      const mangaTitle = bestTitle(manga);

      await updateStatus(`🔍 وجدت: ${mangaTitle}\n📄 جاري البحث عن الفصل ${chapterNumber}...`);

      // ─── المرحلة السابعة/الثامنة: جلب وفلترة الفصول ───
      let volumes;
      try {
        volumes = await fetchAggregate(mangaId, null);
      } catch (err) {
        throw { userMsg: "❌ تعذر الاتصال بخادم المانجا.\nحاول لاحقاً." };
      }

      const entry = findChapterEntry(volumes, chapterNumber);
      if (!entry) {
        throw { userMsg: `❌ الفصل ${chapterNumber} غير متوفر.` };
      }

      // ─── المرحلة التاسعة/العاشرة: اختيار اللغة و Chapter ID ───
      const { chapterId, lang, availableLangs } = await resolveLanguageVariant(entry, requestedLang);

      if (!chapterId) {
        if (requestedLang && availableLangs.length) {
          const labels = availableLangs.map((l) => LANG_LABELS[l] || l).join("، ");
          throw { userMsg: `⚠️ الفصل متوفر بـ${labels} فقط.` };
        }
        throw { userMsg: `❌ الفصل ${chapterNumber} غير متوفر.` };
      }

      await updateStatus(`📥 جاري تجهيز صفحات الفصل ${chapterNumber}...\n📖 ${mangaTitle}`);

      // ─── المرحلة الحادية عشر/الثانية عشر: At-Home Server وبناء الروابط ───
      let pageUrls;
      try {
        pageUrls = await buildPageUrls(chapterId);
      } catch (err) {
        throw { userMsg: "❌ تعذر الاتصال بخادم المانجا.\nحاول لاحقاً." };
      }

      // ─── المرحلة الثالثة عشر: التحقق من الصور ───
      if (!pageUrls.length) {
        throw { userMsg: "❌ الفصل لا يحتوي على صفحات." };
      }

      await updateStatus(
        `📥 جاري تحميل ${pageUrls.length} صفحة...\n📖 ${mangaTitle}\n📄 الفصل ${chapterNumber}`
      );

      // تحميل جميع الصور (محاولات مستقلة، فشل صورة لا يوقف الباقي)
      const downloaded = new Array(pageUrls.length).fill(null);
      await Promise.allSettled(
        pageUrls.map(async (url, i) => {
          try {
            downloaded[i] = await downloadImage(url, i);
          } catch (_) {
            downloaded[i] = null;
          }
        })
      );

      const validFiles = downloaded.filter(Boolean);
      if (!validFiles.length) {
        throw { userMsg: "❌ فشل تحميل صفحات الفصل. حاول مرة أخرى." };
      }

      try {
        if (statusMsgId) await api.unsendMessage(statusMsgId, threadID);
      } catch (_) {}

      // ─── المرحلة الرابعة عشر: إرسال الصور على دفعات ───
      let allSent = true;
      const totalGroups = Math.ceil(validFiles.length / MAX_PER_GROUP);
      for (let i = 0; i < validFiles.length; i += MAX_PER_GROUP) {
        const group = validFiles.slice(i, i + MAX_PER_GROUP);
        const groupNum = Math.floor(i / MAX_PER_GROUP) + 1;
        const isFirst = i === 0;

        const body =
          totalGroups > 1
            ? `📖 ${mangaTitle} — الفصل ${chapterNumber} (${groupNum}/${totalGroups})`
            : `📖 ${mangaTitle} — الفصل ${chapterNumber}`;

        try {
          await global.safeSend(
            api,
            { body, attachment: group.map((f) => fs.createReadStream(f)) },
            threadID,
            null,
            isFirst ? messageID : null
          );
        } catch (err) {
          allSent = false;
        }
        if (i + MAX_PER_GROUP < validFiles.length) await sleep(600);
      }

      await Promise.allSettled(validFiles.map((f) => fs.remove(f)));

      // ─── المرحلة الخامسة عشر: رسالة النهاية ───
      if (allSent && validFiles.length === pageUrls.length) {
        global.safeSend(api, "✅ تم إرسال الفصل بالكامل.\nاستمتع بالقراءة. 📚", threadID, null, null);
      } else {
        global.safeSend(
          api,
          "⚠️ تم إرسال جزء من الفصل.\nيمكنك إعادة المحاولة.",
          threadID,
          null,
          null
        );
      }
    } catch (err) {
      const userMsg = err?.userMsg || `❌ حدث خطأ غير متوقع: ${err?.message?.substring(0, 80) || ""}`;
      try {
        if (statusMsgId) await api.editMessage(userMsg, statusMsgId);
        else global.safeSend(api, userMsg, threadID, null, messageID);
      } catch (_) {
        global.safeSend(api, userMsg, threadID, null, messageID);
      }
    }
  },
};
