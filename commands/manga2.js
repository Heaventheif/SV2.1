// commands/manga.js (أو manga2.js)
const axios = require('axios');
const cheerio = require('cheerio');

module.exports = {
  config: {
    name: "manga2",          // غيّر إلى "manga2" إذا أردت أمراً باسم مختلف
    aliases: ["مانجا", "m"],
    role: 0,
    countDown: 15,
    category: "وسائط",
    description: "كشط صور فصل من مانجا العاشق - استخدم .manga <اسم المانجا> <رقم الفصل>"
  },

  onStart: async ({ api, event, args }) => {
    const { threadID, messageID } = event;

    if (args.length < 2) {
      return api.sendMessage(
        `⚠️ الاستخدام:\n.manga <اسم المانجا> <رقم الفصل>\n\n📌 مثال: .manga one piece 234\n📌 مثال: .manga kingdom 1`,
        threadID,
        messageID
      );
    }

    // استخراج رقم الفصل (آخر وسيط) واسم المانجا (الباقي)
    const chapterNumber = args[args.length - 1];
    const mangaNameParts = args.slice(0, -1);
    const rawMangaName = mangaNameParts.join(' '); // للبحث
    const initialSlug = mangaNameParts.join('-').toLowerCase(); // تخمين أولي

    const baseUrl = "https://3asq.pro";
    let chapterUrl = `${baseUrl}/manga/${encodeURIComponent(initialSlug)}/${encodeURIComponent(chapterNumber)}/`;

    await api.sendMessage(`🔍 جاري البحث عن الفصل ${chapterNumber} من "${rawMangaName}" ...`, threadID, messageID);

    try {
      // دالة مساعدة لجلب الصور من رابط معين
      const fetchImages = async (url) => {
        const response = await axios.get(url, {
          timeout: 20000,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
        const $ = cheerio.load(response.data);
        let images = [];
        // محاولة المحددات المختلفة
        const selectors = ['.page-break img', '.reading-content img'];
        for (const selector of selectors) {
          const elements = $(selector);
          if (elements.length) {
            elements.each((i, el) => {
              const img = $(el);
              let src = img.attr('data-src') || img.attr('data-lazy-src') || img.attr('src');
              if (src) {
                try { images.push(new URL(src, baseUrl).href); }
                catch (e) { /* تجاهل */ }
              }
            });
            if (images.length) break;
          }
        }
        return images;
      };

      // المحاولة الأولى بالـ slug المُخمَّن
      let images = await fetchImages(chapterUrl);

      // إذا لم نجد صوراً، حاول البحث عن الـ slug الصحيح
      if (images.length === 0) {
        // البحث في الموقع عن المانجا
        const searchUrl = `${baseUrl}/?s=${encodeURIComponent(rawMangaName)}`;
        const searchRes = await axios.get(searchUrl, {
          timeout: 10000,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const $ = cheerio.load(searchRes.data);
        // استخراج أول رابط مانجا من نتائج البحث
        const firstResult = $('.page-item-detail .item-thumb a').first();
        const href = firstResult.attr('href');
        if (href) {
          // استخراج الـ slug من الرابط: https://3asq.pro/manga/kingdom-2/
          const slugMatch = href.match(/\/manga\/([^\/]+)\//);
          if (slugMatch) {
            const correctSlug = slugMatch[1];
            // إعادة بناء الرابط بالـ slug الصحيح
            const correctedUrl = `${baseUrl}/manga/${encodeURIComponent(correctSlug)}/${encodeURIComponent(chapterNumber)}/`;
            await api.sendMessage(`🔄 تم العثور على المانجا باسم "${correctSlug}"، جاري المحاولة ...`, threadID, messageID);
            images = await fetchImages(correctedUrl);
            // تحديث chapterUrl للاستخدام في الرسالة النهائية
            chapterUrl = correctedUrl;
          }
        }
      }

      if (images.length === 0) {
        return api.sendMessage(
          `❌ لم يتم العثور على أي صور في هذا الفصل.\nتأكد من:\n- اسم المانجا صحيح\n- رقم الفصل صحيح\n- الرابط المحاول: ${chapterUrl}`,
          threadID,
          messageID
        );
      }

      // عرض النتائج
      const total = images.length;
      const previewLimit = 10;
      let reply = `📖 **مانجا:** ${rawMangaName}\n📄 **الفصل:** ${chapterNumber}\n🖼️ **عدد الصور:** ${total}\n\n`;
      images.slice(0, previewLimit).forEach((url, i) => {
        reply += `${i+1}. ${url}\n`;
      });
      if (total > previewLimit) reply += `\n... و ${total - previewLimit} صورة أخرى`;

      await api.sendMessage(reply, threadID, messageID);
      if (images.length > 0) {
        await api.sendMessage(`🖼️ معاينة الصفحة الأولى:\n${images[0]}`, threadID, messageID);
      }

    } catch (error) {
      console.error('[manga] خطأ:', error.message);
      let errorMsg = `❌ حدث خطأ:\n`;
      if (error.code === 'ECONNABORTED') errorMsg += `انتهت المهلة. حاول مرة أخرى.`;
      else if (error.response) errorMsg += `الخادم رد بـ ${error.response.status}`;
      else errorMsg += error.message;
      await api.sendMessage(errorMsg, threadID, messageID);
    }
  }
};