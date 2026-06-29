"use strict";
/**
 * utils/danceSticker.js
 * يجلب GIF رقص عشوائي من Giphy مباشرة على Render (بدون HF)
 * - يدور على قائمة tags ثابتة لتنويع النتائج
 * - يكاش روابط كل tag لتجنب تكرار نفس الـ GIF
 * - fire-and-forget: لا يحجب إرسال الأغنية
 */

const axios = require("axios");

const GIPHY_KEY = process.env.GIPHY_API_KEY || "";
const GIPHY_SEARCH = "https://api.giphy.com/v1/gifs/search";

// ─── قائمة tags الرقص المتنوعة ────────────────────────────────
const DANCE_TAGS = [
  "happy dance",
  "dance moves",
  "light dance",
  "funny dance",
  "black guy dancing",
  "classic dance",
  "dance meme",
  "celebration dance",
  "excited dance",
  "silly dance",
  "smooth dance",
  "dance party",
  "kid dancing",
  "old man dancing",
  "cat dancing",
];

// ─── كاش روابط لكل tag (يُملأ تدريجياً) ─────────────────────
const _cache = new Map(); // tag → [url, url, ...]
let _tagIndex = 0;        // نتناوب على الـ tags بالترتيب

// ─── cooldown عند فشل Giphy ──────────────────────────────────
let _lastFailAt = 0;
const FAIL_COOLDOWN = 60 * 1000;

async function fetchGifUrls(tag) {
  if (!GIPHY_KEY) return [];
  try {
    const res = await axios.get(GIPHY_SEARCH, {
      params: { api_key: GIPHY_KEY, q: tag, limit: 15, rating: "pg-13" },
      timeout: 10000,
    });
    return (res.data?.data || [])
      .map(g => g?.images?.downsized?.url)
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

async function getRandomGifUrl() {
  // تناوب على الـ tags
  const tag = DANCE_TAGS[_tagIndex % DANCE_TAGS.length];
  _tagIndex++;

  // إذا عندنا كاش لهذا الـ tag اختر منه فوراً
  if (_cache.has(tag) && _cache.get(tag).length > 0) {
    const urls = _cache.get(tag);
    // shuffle بسيط: اختر عشوائياً ثم احذف من القائمة لتجنب التكرار
    const idx = Math.floor(Math.random() * urls.length);
    const url = urls.splice(idx, 1)[0];
    // إذا نفدت الروابط، احذف الكاش ليُعاد جلبه لاحقاً
    if (urls.length === 0) _cache.delete(tag);
    return url;
  }

  // جلب روابط جديدة
  const urls = await fetchGifUrls(tag);
  if (!urls.length) return null;

  // خزّن واختر
  _cache.set(tag, urls);
  const idx = Math.floor(Math.random() * urls.length);
  return _cache.get(tag).splice(idx, 1)[0];
}

// ─── pre-warm: جلب أول tagين عند بدء البوت ──────────────────
async function prewarm() {
  if (!GIPHY_KEY) return;
  for (let i = 0; i < 2; i++) {
    const tag = DANCE_TAGS[i];
    if (!_cache.has(tag)) {
      const urls = await fetchGifUrls(tag);
      if (urls.length) _cache.set(tag, urls);
    }
  }
}
prewarm().catch(() => {});

// ─── الدالة الرئيسية (fire-and-forget من الأوامر) ────────────
async function sendMoodSticker(api, threadID) {
  if (!GIPHY_KEY) return;
  if (Date.now() - _lastFailAt < FAIL_COOLDOWN) return;

  // fire-and-forget
  (async () => {
    try {
      const gifUrl = await getRandomGifUrl();
      if (!gifUrl) return;

      const res = await axios.get(gifUrl, {
        responseType: "arraybuffer",
        timeout: 15000,
      });
      const buffer = Buffer.from(res.data);
      if (!buffer.length) return;

      const { Readable } = require("stream");
      const stream = Readable.from(buffer);
      stream.path = `dance_${Date.now()}.gif`;

      await new Promise((resolve, reject) =>
        api.sendMessage(
          { attachment: stream },
          threadID,
          err => err ? reject(err) : resolve()
        )
      );
    } catch (err) {
      _lastFailAt = Date.now();
      console.warn("[STICKER] فشل:", err.message);
    }
  })();
}

module.exports = { sendMoodSticker };
