// commands/manga.js
const axios = require("axios");

const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || "";
const HF_SPACE_URL = process.env.HF_SPACE_URL || "";

// الرمز الخاص الذي يطلب من الـ API البحث عن آخر فصل منشور بدل رقم فصل محدد
const LATEST_CHAPTER_FLAG = "%%";

module.exports = {
  config: {
    name: "manga",
    aliases: ["مانجا"],
    role: 0,
    countDown: 15,
    category: "وسائط",
    description: "تحميل صفحات فصل مانجا، أو آخر فصل منشور باستخدام %%",
  },

  // الاستخدام:
  //   .manga <اسم-المانجا> <رقم-الفصل>      → فصل محدد
  //   .manga %% <اسم-المانجا>                → آخر فصل منشور تلقائياً
  // مثال: .manga one-piece 1186
  // مثال: .manga %% ون بيس
  onStart: async ({ api, event, args }) => {
    const { threadID, messageID } = event;

    if (args.length < 2) {
      return api.sendMessage(
        `❌ الاستخدام:\n` +
          `.manga <اسم-المانجا> <رقم-الفصل>\n` +
          `.manga ${LATEST_CHAPTER_FLAG} <اسم-المانجا>  (آخر فصل تلقائياً)\n` +
          `مثال: .manga one-piece 1186\n` +
          `مثال: .manga ${LATEST_CHAPTER_FLAG} ون بيس`,
        threadID,
        messageID
      );
    }

    // وضع "آخر فصل": لو وُجد %% في أي موضع من الأرغيومنتس، يُحذف ويُعتبر الباقي اسم المانجا
    const flagIndex = args.indexOf(LATEST_CHAPTER_FLAG);
    const latestMode = flagIndex !== -1;

    let mangaName;
    let chapterParam;

    if (latestMode) {
      const nameParts = args.filter((_, idx) => idx !== flagIndex);
      if (nameParts.length === 0) {
        return api.sendMessage(
          `❌ الاستخدام: .manga ${LATEST_CHAPTER_FLAG} <اسم-المانجا>\nمثال: .manga ${LATEST_CHAPTER_FLAG} ون بيس`,
          threadID,
          messageID
        );
      }
      mangaName = nameParts.join("-");
      chapterParam = LATEST_CHAPTER_FLAG;
    } else {
      chapterParam = args[args.length - 1];
      mangaName = args.slice(0, -1).join("-");
    }

    if (!HF_SPACE_URL) {
      return api.sendMessage("❌ لم يتم ضبط HF_SPACE_URL في إعدادات البوت.", threadID, messageID);
    }

    await api.sendMessage(
      latestMode
        ? `🔎 جاري البحث عن آخر فصل منشور لـ "${mangaName}"...`
        : `🔎 جاري جلب فصل "${mangaName}" رقم ${chapterParam}...`,
      threadID,
      messageID
    );

    let images = [];
    let resolvedChapterNumber = chapterParam;
    try {
      const response = await axios.post(
        `${HF_SPACE_URL}/manga/extract-chapter`,
        { manga_name: mangaName, chapter_number: chapterParam },
        {
          headers: { "Content-Type": "application/json", "X-Internal-Token": INTERNAL_TOKEN },
          timeout: 60000,
        }
      );

      if (response.data.status !== "ok") {
        return api.sendMessage(`❌ ${response.data.message || "تعذر جلب الفصل."}`, threadID, messageID);
      }

      // في وضع %% يرجع الـ API رقم/تسمية الفصل الحقيقي المكتشف بدل "%%"
      resolvedChapterNumber = response.data.chapter_number || chapterParam;

      images = response.data.images || [];
      if (images.length === 0) {
        return api.sendMessage("❌ لم يتم العثور على صور لهذا الفصل.", threadID, messageID);
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message;
      return api.sendMessage(`❌ خطأ أثناء الاتصال بالخادم: ${msg}`, threadID, messageID);
    }

    if (latestMode) {
      await api.sendMessage(
        `📸 آخر فصل منشور هو رقم ${resolvedChapterNumber} — تم العثور على ${images.length} صفحة، جاري الإرسال...`,
        threadID,
        messageID
      );
    } else {
      await api.sendMessage(`📸 تم العثور على ${images.length} صفحة، جاري الإرسال...`, threadID, messageID);
    }

    // تحميل كل صور الفصل والتحقق من صحتها، ثم إرسالها كلها في رسالة واحدة فقط
    // (مصفوفة attachment واحدة تحتوي كل الصور = ألبوم واحد متكامل في فيسبوك)
    const streams = [];
    let skippedCount = 0;

    for (const url of images) {
      try {
        const imgRes = await axios.get(url, { responseType: "stream", timeout: 30000 });

        // تحقق إلزامي: يجب أن يكون المحتوى صورة فعلية (image/*) وليس صفحة
        // HTML (مثل صفحة 404 ترجع بكود 200 - "soft 404" شائع في WordPress)
        const contentType = (imgRes.headers["content-type"] || "").toLowerCase();
        if (!contentType.startsWith("image/")) {
          skippedCount++;
          continue;
        }

        streams.push(imgRes.data);
      } catch (e) {
        // فشل التحميل (404 حقيقي، انقطاع شبكة...) — تجاهل الصورة والمتابعة
        skippedCount++;
      }
    }

    if (streams.length === 0) {
      return api.sendMessage(
        "❌ فشل إرسال جميع صور هذا الفصل (روابط غير صالحة أو محتوى غير صورة).",
        threadID,
        messageID
      );
    }

    // إرسال كل صور الفصل في رسالة واحدة فقط
    await api.sendMessage({ attachment: streams }, threadID);
    const sentCount = streams.length;

    await api.sendMessage(
      `✅ تم إرسال فصل "${mangaName}" رقم ${resolvedChapterNumber} بالكامل (${images.length} صفحة).`,
      threadID,
      messageID
    );
  },
};
