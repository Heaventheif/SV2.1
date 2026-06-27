const axios = require("axios");

const FB_GRAPH_TOKEN = process.env.FB_GRAPH_ACCESS_TOKEN || "6628568379%7Cc1e620fa708a1d5696fb991c1bde5662";

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept-Language": "ar,en;q=0.9",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "sec-fetch-site": "none",
  "sec-fetch-mode": "navigate",
};

module.exports = {
  config: {
    name: "uid",
    aliases: ["معرف", "ايدي", "id"],
    version: "4.0.0",
    author: "Enhanced UID Extractor",
    countDown: 3,
    role: 0,
    shortDescription: { ar: "جلب UID من رابط أو منشن أو يوزرنيم" },
    category: "أدوات",
    guide: { ar: "{pn} [رابط / @منشن / يوزرنيم / UID]" },
  },

  onStart: async ({ api, event, args, message }) => {
    const { senderID, mentions, messageReply } = event;
    let targetUID = null;

    try {
      const mentionIDs = Object.keys(mentions || {});

      // ── 1. منشن ──────────────────────────────────────────
      if (mentionIDs.length > 0) {
        targetUID = mentionIDs[0];

      // ── 2. ريبلاي ─────────────────────────────────────────
      } else if (messageReply?.senderID) {
        targetUID = messageReply.senderID;

      // ── 3. إدخال يدوي ─────────────────────────────────────
      } else if (args[0]) {
        const input = args.join(" ").trim();

        // UID رقمي مباشر
        if (/^\d{5,20}$/.test(input)) {
          targetUID = input;

        // رابط فيسبوك
        } else if (/facebook\.com|fb\.com|fb\.me/i.test(input)) {
          targetUID = await resolveUID(input);

        // يوزرنيم نصي
        } else if (/^[a-zA-Z0-9._]+$/.test(input)) {
          targetUID = await resolveUID(`https://www.facebook.com/${input}`);
        }

      // ── 4. بدون إدخال = UID المرسل نفسه ──────────────────
      } else {
        targetUID = senderID;
      }

      if (targetUID) {
        message.reply(`🆔 ${targetUID}`);
      } else {
        message.reply(
          "❌ فشل استخراج UID.\n" +
          "💡 تأكد من صحة الرابط أو استخدم UID الرقمي مباشرة."
        );
      }

    } catch (err) {
      console.error("[uid] خطأ:", err.message);
      message.reply("❌ حدث خطأ أثناء معالجة الطلب.");
    }
  },
};

// ═══════════════════════════════════════════════════════════════
// resolveUID — يجرّب طرقاً متعددة بالترتيب حتى ينجح إحداها
// ═══════════════════════════════════════════════════════════════
async function resolveUID(input) {
  input = input.trim();

  // ── طريقة 0: UID رقمي في الرابط ─────────────────────────
  const numInUrl = input.match(/(?:facebook\.com\/(?:profile\.php\?id=)?|\/)?(\d{8,20})/);
  if (numInUrl) return numInUrl[1];

  // ── تنظيف الرابط واستخراج الـ slug ──────────────────────
  let slug = input;
  try {
    slug = new URL(input.startsWith("http") ? input : "https://" + input).pathname
      .replace(/^\//, "").replace(/\/$/, "").split("/")[0];
  } catch (_) {
    slug = input.replace(/^.*facebook\.com\//i, "").split(/[/?#]/)[0];
  }

  const ignoreSlugs = ["watch", "reel", "reels", "stories", "groups", "marketplace",
    "pages", "events", "photo", "video", "share", "sharer", "permalink"];
  if (!slug || ignoreSlugs.includes(slug.toLowerCase())) return null;

  // ── طريقة 1: Graph API ───────────────────────────────────
  try {
    const res = await axios.get(`https://graph.facebook.com/${encodeURIComponent(slug)}`, {
      params: { fields: "id", access_token: FB_GRAPH_TOKEN },
      timeout: 8000,
    });
    if (res.data?.id) return res.data.id;
  } catch (_) {}

  // ── طريقة 2: scrape صفحة فيسبوك ─────────────────────────
  try {
    const html = await fetchHTML(`https://www.facebook.com/${slug}`);
    const id   = extractIDFromHTML(html);
    if (id) return id;
  } catch (_) {}

  // ── طريقة 3: النسخة المحمولة mbasic ─────────────────────
  try {
    const html = await fetchHTML(`https://mbasic.facebook.com/${slug}`);
    const id   = extractIDFromHTML(html);
    if (id) return id;
  } catch (_) {}

  // ── طريقة 4: API بديل (lookup2) ─────────────────────────
  try {
    const res = await axios.get(`https://lookup2.p.rapidapi.com/`, {
      params: { username: slug },
      headers: {
        "x-rapidapi-host": "lookup2.p.rapidapi.com",
        "x-rapidapi-key": process.env.RAPIDAPI_KEY || "",
      },
      timeout: 8000,
    });
    if (res.data?.id) return res.data.id;
  } catch (_) {}

  // ── طريقة 5: findmyfbid.com ──────────────────────────────
  try {
    const profileUrl = `https://www.facebook.com/${slug}`;
    const html = await fetchHTML(`https://findmyfbid.com/`, {
      method: "POST",
      data: new URLSearchParams({ url: profileUrl }).toString(),
      headers: {
        ...BROWSER_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": "https://findmyfbid.com/",
      },
    });
    const match = html.match(/(?:id|uid|facebook id)[^\d]*(\d{8,20})/i);
    if (match) return match[1];
  } catch (_) {}

  return null;
}

async function fetchHTML(url, options = {}) {
  const res = await axios({
    url,
    method:  options.method || "GET",
    data:    options.data,
    headers: { ...BROWSER_HEADERS, ...(options.headers || {}) },
    timeout: 15000,
    maxRedirects: 5,
  });
  return typeof res.data === "string" ? res.data : JSON.stringify(res.data);
}

function extractIDFromHTML(html) {
  if (!html) return null;

  const patterns = [
    /"userID"\s*:\s*"(\d+)"/,
    /"entity_id"\s*:\s*"(\d+)"/,
    /"profileOwnerID"\s*:\s*"(\d+)"/,
    /"USER_ID"\s*:\s*"(\d+)"/,
    /"owner"\s*:\s*\{"__typename"[^}]*"id"\s*:\s*"(\d+)"/,
    /content="https:\/\/www\.facebook\.com\/(\d{8,20})"/,
    /"id"\s*:\s*"(\d{8,20})"\s*,\s*"name"/,
    /profile_id=(\d{8,20})/,
    /\"subject_id\"\s*:\s*\"(\d{8,20})\"/,
    /pageID\s*=\s*"(\d{8,20})"/,
    /__user=(\d{8,20})/,
    /\{"uid":(\d{8,20})\}/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1] && match[1] !== "0") return match[1];
  }
  return null;
}
