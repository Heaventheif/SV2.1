const axios = require("axios");
const { translateToArabic } = require("../utils/translator");

// أي من هذه الكلمات إذا كانت هي الأمر المُستدعى (الاسم أو الأليسات) تُرجع حقيقة قطط مباشرة
const CAT_TRIGGERS = ["catfact", "catfacts", "cat", "قط", "قطة"];
// أي من هذه الكلمات إذا كانت هي الأمر المُستدعى (الاسم أو الأليسات) تُرجع حقيقة كلاب مباشرة
const DOG_TRIGGERS = ["dogfact", "dogfacts", "dog", "كلب"];

async function getCatFact() {
  const res  = await axios.get("https://catfact.ninja/fact", { timeout: 8000 });
  const fact = res.data?.fact;
  if (!fact) throw new Error("لا توجد بيانات");
  return { emoji: "🐱", label: "حقيقة عن القطط", fact };
}

async function getDogFact() {
  const res  = await axios.get("https://dogapi.dog/api/v2/facts", { timeout: 8000 });
  const fact = res.data?.data?.[0]?.attributes?.body;
  if (!fact) throw new Error("لا توجد بيانات");
  return { emoji: "🐶", label: "حقيقة عن الكلاب", fact };
}

async function sendFact(api, threadID, messageID, type) {
  try {
    const { emoji, label, fact } = type === "dog" ? await getDogFact() : await getCatFact();
    const translated = await translateToArabic(fact);
    global.safeSend(api, `${emoji} ${label}\n\n${translated}`, threadID, null, messageID);
  } catch {
    global.safeSend(api, "❌ فشل جلب الحقيقة — حاول مرة أخرى", threadID, null, messageID);
  }
}

module.exports = {
  config: {
    name: "animal",
    aliases: ["حيوان", ...CAT_TRIGGERS, ...DOG_TRIGGERS],
    version: "1.0.0",
    author: "Sunken",
    countDown: 5,
    role: 0,
    shortDescription: { ar: "حقيقة عشوائية عن القطط أو الكلاب 🐱🐶" },
    category: "fun",
    guide: {
      ar:
        "{pn}cat / {pn}قط          — حقيقة عن القطط\n" +
        "{pn}dog / {pn}كلب        — حقيقة عن الكلاب\n" +
        "{pn}animal cat            — حقيقة عن القطط\n" +
        "{pn}animal dog            — حقيقة عن الكلاب"
    }
  },

  onStart: async function ({ api, event, args }) {
    const { threadID, messageID, body } = event;

    // الكلمة الأولى في الرسالة بعد إزالة أي بادئة (., !, # ...) لتحديد أي أليس تم استدعاؤه فعلياً
    const firstWord = (body || "")
      .trim()
      .split(/\s+/)[0]
      ?.toLowerCase()
      .replace(/^[^a-zA-Z\u0600-\u06FF]+/, "") || "";

    if (DOG_TRIGGERS.includes(firstWord)) return sendFact(api, threadID, messageID, "dog");
    if (CAT_TRIGGERS.includes(firstWord)) return sendFact(api, threadID, messageID, "cat");

    // تم الاستدعاء عبر animal / حيوان — نتحقق من الوسيط الأول
    const sub = (args[0] || "").toLowerCase();
    if (DOG_TRIGGERS.includes(sub)) return sendFact(api, threadID, messageID, "dog");
    if (CAT_TRIGGERS.includes(sub)) return sendFact(api, threadID, messageID, "cat");

    // بدون تحديد — نختار عشوائياً بين قطة وكلب
    return sendFact(api, threadID, messageID, Math.random() < 0.5 ? "cat" : "dog");
  }
};
