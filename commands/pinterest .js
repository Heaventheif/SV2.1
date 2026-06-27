const axios = require("axios");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");

const FERDEV_API_KEY = process.env.FERDEV_API_KEY || "";
const MAX_PER_GROUP = 10;

module.exports = {
  config: {
    name: "pinterest",
    aliases: ["pin", "بينتريست", "صورة"],
    version: "2.0.0-FerDev",
    author: "Shadow Garden",
    countDown: 5,
    role: 0,
    nonPrefix: true,
    shortDescription: { ar: "البحث عن صور من Pinterest" },
    category: "media"
  },

  onStart: async function ({ api, event, args, message }) {
    const { threadID, messageID } = event;

    let limit = 5;
    const filteredArgs = [];
    for (const arg of args) {
      const match = arg.match(/^-(\d+)$/);
      if (match) {
        limit = Math.min(Math.max(parseInt(match[1]), 1), 20);
      } else {
        filteredArgs.push(arg);
      }
    }
    const query = filteredArgs.join(" ").trim();

    if (!query) {
      return message.reply(
        "📌 البحث في Pinterest\n\n" +
        "📝 الاستخدام: pinterest [كلمة البحث] [-عدد]\n" +
        "💡 أمثلة:\n" +
        "  • pinterest nature wallpaper\n" +
        "  • pinterest cat -10\n" +
        "  • pinterest sunset -3\n\n" +
        "⚠️ ملاحظات:\n" +
        "  • الافتراضي 5 صور\n" +
        "  • الحد الأقصى 20 صورة\n" +
        "  • ترسل معاً كمجموعة"
      );
    }

    if (!FERDEV_API_KEY) {
      return message.reply("⚠️ لم يتم تعيين FERDEV_API_KEY في Environment Variables");
    }

    try {
      console.log(`[PINTEREST] 🔍 Searching: ${query} | limit: ${limit}`);

      const response = await axios.get("https://api.ferdev.my.id/search/pinterest", {
        params: { query, apikey: FERDEV_API_KEY },
        timeout: 30000,
        headers: { "User-Agent": "SunkenBot/2.0" }
      });

      const rawResults = response.data?.result;
      if (!rawResults || rawResults.length === 0) {
        return api.sendMessage("❌ لم أجد نتائج للبحث", threadID, null, messageID);
      }

      const imageUrls = rawResults
        .slice(0, limit)
        .map(item => item.url || item.image || (typeof item === "string" ? item : null))
        .filter(Boolean);

      if (imageUrls.length === 0) {
        return api.sendMessage("❌ لم أجد روابط صور صالحة", threadID, null, messageID);
      }

      const tmpFiles = [];
      console.log(`[PINTEREST] 📥 Downloading ${imageUrls.length} images...`);

      await Promise.allSettled(
        imageUrls.map(async (url, i) => {
          try {
            const fileName = path.join(os.tmpdir(), `pin_${Date.now()}_${i}.jpg`);
            const imgRes = await axios.get(url, {
              responseType: "arraybuffer",
              timeout: 30000,
              headers: { "User-Agent": "SunkenBot/2.0" }
            });
            await fs.writeFile(fileName, imgRes.data);
            tmpFiles[i] = fileName;
          } catch (e) {
            console.error(`[PINTEREST] ❌ Image ${i + 1} failed: ${e.message}`);
          }
        })
      );

      const validFiles = tmpFiles.filter(Boolean);
      if (validFiles.length === 0) {
        return api.sendMessage("❌ فشل تحميل جميع الصور", threadID, null, messageID);
      }

      for (let i = 0; i < validFiles.length; i += MAX_PER_GROUP) {
        const group = validFiles.slice(i, i + MAX_PER_GROUP);
        const isFirst = i === 0;
        const groupNum = Math.floor(i / MAX_PER_GROUP) + 1;
        const totalGroups = Math.ceil(validFiles.length / MAX_PER_GROUP);

        const body = totalGroups > 1
          ? `📌 ${query} (${groupNum}/${totalGroups})`
          : `📌 ${query} — ${validFiles.length} صورة`;

        await api.sendMessage({
          body,
          attachment: group.map(f => fs.createReadStream(f))
        }, threadID, null, isFirst ? messageID : null);

        console.log(`[PINTEREST] ✅ Sent group ${groupNum}/${totalGroups} (${group.length} images)`);
      }

      await Promise.allSettled(validFiles.map(f => fs.remove(f)));
      console.log(`[PINTEREST] 🧹 Cleaned ${validFiles.length} temp files`);

    } catch (error) {
      console.error("[PINTEREST ERROR]", error.message);
      api.sendMessage(`❌ فشل: ${error.message?.substring(0, 80)}`, threadID, null, messageID);
    }
  }
};
