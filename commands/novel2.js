const axios = require("axios");

// ─── متغيرات البيئة ───────────────────────────────────────────
const HF_SPACE_URL   = process.env.HF_NOVEL_URL;    // رابط فضاء HF للروايات
const RENDER_WEBHOOK = process.env.RENDER_PUBLIC_URL; // رابط Render لاستقبال النتيجة

// ─── مخزن الجلسات النشطة في الذاكرة ─────────────────────────
const activeSessions = new Map();

// ─── قائمة الـ 50 موقع مرتبة من الأسهل للأصعب ───────────────
const TARGET_WEBSITES = [
  "https://novelhall.com",         "https://novelonlinefull.com",
  "https://bestlightnovel.com",    "https://novelall.com",
  "https://novelreader.org",       "https://freenovelread.com",
  "https://novelonl.com",          "https://novelscafe.com",
  "https://novelcrow.com",         "https://novelbest.com",
  "https://readfreeonlinenovels.com","https://webnovelfree.com",
  "https://freewebnovel.com",      "https://novelbin.me",
  "https://novelbin.com",          "https://novelfull.net",
  "https://novelbuddy.com",        "https://allnovel.org",
  "https://novelnext.com",         "https://inovelhub.com",
  "https://readwebnovels.net",     "https://novelzec.com",
  "https://novelcrest.com",        "https://novelrock.com",
  "https://novelxo.com",           "https://novelgate.net",
  "https://skynovel.org",          "https://novelglow.com",
  "https://novelstar.top",         "https://topwebnovel.com",
  "https://vipnovel.com",          "https://wtr-lab.com",
  "https://mtlnovel.com",          "https://fanmtl.com",
  "https://novellive.com",         "https://readwn.com",
  "https://novelmtl.com",          "https://snowmtl.com",
  "https://mtlreader.com",         "https://mtlnation.com",
  "https://ranobes.top",           "https://lightnovelworld.org",
  "https://lightnovelpub.com",     "https://lightnovelcave.com",
  "https://boxnovel.com",          "https://novelcool.com",
  "https://webnovelpub.com",       "https://novelupdates.com",
  "https://wuxiaworld.com",        "https://webnovel.com",
];

// ─── بناء روابط الـ 50 موقع ديناميكياً ──────────────────────
function buildNovelUrls(novelName, chapterNum) {
  const slug = novelName.toLowerCase().trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

  return TARGET_WEBSITES.map(base => {
    if (base.includes("novelhall"))
      return `${base}/novel/${slug}-chapter-${chapterNum}.html`;
    if (base.includes("novelonlinefull") || base.includes("bestlightnovel"))
      return `${base}/novel/${slug}/chapter_${chapterNum}`;
    if (
      base.includes("novelall") || base.includes("freewebnovel") ||
      base.includes("novelbin") || base.includes("novelfull") ||
      base.includes("novelbuddy") || base.includes("wtr-lab") ||
      base.includes("mtlnovel") || base.includes("readwn")
    )
      return `${base}/novel/${slug}/chapter-${chapterNum}`;
    return `${base}/${slug}/chapter-${chapterNum}`;
  });
}

// ─── إرسال طلب كشط للموقع التالي عبر HF ─────────────────────
async function tryNextSite(sessionId) {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  // استنفدنا كل المواقع الـ 50
  if (session.index >= session.urls.length) {
    try {
      await session.api.sendMessage(
        `❌ تعذر جلب الفصل ${session.chapterNum} من رواية "${session.novelName}"\n` +
        `جُربت ${session.urls.length} مصدراً ولم ينجح أي منها.`,
        session.threadID, null, session.messageID
      );
    } catch (_) {}
    activeSessions.delete(sessionId);
    return;
  }

  const targetUrl   = session.urls[session.index];
  const webhookUrl  = `${RENDER_WEBHOOK}/novel2-result?sid=${sessionId}`;

  session.index++;

  try {
    await axios.get(`${HF_SPACE_URL}/trigger-scrape`, {
      params: { url: targetUrl, webhook: webhookUrl },
      timeout: 8000,
    });
  } catch (_) {
    // فشل الطلب → ننتقل للموقع التالي مباشرة
    tryNextSite(sessionId);
  }
}

// ─── استقبال النتيجة من HF عبر Webhook ───────────────────────
// هذه الدالة تُستدعى من مسار Express الخارجي في index.js أو goatbot
// يجب تسجيل المسار التالي في ملف السيرفر الرئيسي:
//   app.post('/novel2-result', require('./novel2').handleWebhook);
async function handleWebhook(req, res) {
  const sessionId = req.query.sid;
  const payload   = req.body;

  res.status(200).json({ ok: true }); // إغلاق الاتصال مع HF فوراً

  const session = activeSessions.get(sessionId);
  if (!session) return;

  if (payload.status === "success" && payload.data) {
    activeSessions.delete(sessionId);

    const header   = `📖 ${session.novelName} — الفصل ${session.chapterNum}\n${"─".repeat(30)}\n\n`;
    const fullText = header + payload.data;
    const maxLen   = 1900;
    let i = 0;

    while (i < fullText.length) {
      let chunk = fullText.substr(i, maxLen);
      const cut = chunk.lastIndexOf("\n\n");
      if (cut > 800 && i + maxLen < fullText.length) chunk = chunk.substr(0, cut);

      await new Promise(r => setTimeout(r, 400));
      try {
        await new Promise((resolve, reject) =>
          session.api.sendMessage(chunk, session.threadID,
            (err, info) => err ? reject(err) : resolve(info),
            session.messageID)
        );
      } catch (_) {}

      i += chunk.length;
    }
  } else {
    // كشط فاشل → جرب الموقع التالي
    tryNextSite(sessionId);
  }
}

// ─── Module Export بصيغة Goatv2 ──────────────────────────────
module.exports = {
  config: {
    name: "novel2",
    aliases: ["رواية2", "n2"],
    version: "1.0.0",
    author: "Sunken",
    countDown: 20,
    role: 0,
    shortDescription: { ar: "قراءة فصول الروايات من 50 مصدراً عبر HF" },
    longDescription:  { ar: "يبحث عن الفصل المطلوب في 50 موقع روايات ويترجمه بالتدريج" },
    category: "tools",
    guide: {
      ar: "{pn}novel2 [اسم الرواية] [رقم الفصل]\nمثال: .novel2 martial peak 100"
    }
  },

  // تصدير handleWebhook لاستخدامه في السيرفر الرئيسي
  handleWebhook,

  onStart: async function ({ api, event, args }) {
    const { threadID, messageID } = event;

    // ─── التحقق من المتغيرات البيئية ─────────────────────────
    if (!HF_SPACE_URL || !RENDER_WEBHOOK) {
      return api.sendMessage(
        "⚠️ المتغيرات البيئية غير مضبوطة:\n• HF_NOVEL_URL\n• RENDER_PUBLIC_URL",
        threadID, null, messageID
      );
    }

    // ─── التحقق من المدخلات ───────────────────────────────────
    if (args.length < 2) {
      return api.sendMessage(
        "📚 قارئ الروايات المتقدم (50 مصدر)\n\n" +
        "📝 الاستخدام:\n  .novel2 [اسم الرواية] [رقم الفصل]\n\n" +
        "💡 أمثلة:\n" +
        "  .novel2 martial peak 1\n" +
        "  .novel2 solo leveling 100\n\n" +
        "🌐 يبحث تلقائياً في 50 موقعاً حتى ينجح",
        threadID, null, messageID
      );
    }

    const lastArg = args[args.length - 1];
    if (isNaN(lastArg) || Number(lastArg) < 1) {
      return api.sendMessage(
        "❌ آخر شيء يجب أن يكون رقم الفصل\n💡 مثال: .novel2 martial peak 1",
        threadID, null, messageID
      );
    }

    const chapterNum = parseInt(lastArg);
    const novelName  = args.slice(0, -1).join(" ");
    const sessionId  = `${threadID}_${Date.now()}`;

    // ─── تسجيل الجلسة ────────────────────────────────────────
    activeSessions.set(sessionId, {
      api, threadID, messageID,
      novelName, chapterNum,
      urls: buildNovelUrls(novelName, chapterNum),
      index: 0,
    });

    // ─── رسالة الانتظار ───────────────────────────────────────
    try {
      await new Promise((resolve, reject) =>
        api.sendMessage(
          `⏳ جاري البحث عن الفصل...\n📖 ${novelName}\n📄 الفصل ${chapterNum}\n\n🌐 سيجرب حتى 50 مصدراً تلقائياً`,
          threadID,
          (err, info) => err ? reject(err) : resolve(info),
          messageID
        )
      );
    } catch (_) {}

    // ─── بدء الكشط من الموقع الأول ───────────────────────────
    tryNextSite(sessionId);
  }
};
