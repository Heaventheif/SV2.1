# 🤖 SunkenBot — منظومة بوت متعددة الاستضافة

<div align="center">

**بوت فيسبوك ماسنجر مدعوم بطبقة API موحّدة من خدمات الذكاء الاصطناعي والوسائط**

![Node.js](https://img.shields.io/badge/Node.js-22%2F24%20LTS-green?logo=node.js)
![Python](https://img.shields.io/badge/Python-3.11-blue?logo=python)
![FastAPI](https://img.shields.io/badge/FastAPI-latest-009688?logo=fastapi)
![HuggingFace](https://img.shields.io/badge/HuggingFace-API%20Space-yellow?logo=huggingface)
![License](https://img.shields.io/badge/License-MIT-lightgrey)

</div>

---

## 📋 نظرة عامة على المنظومة

المشروع مكوَّن من **مكوّنين منفصلين يعملان معاً**:

| المكوّن | المستودع | الدور |
|---|---|---|
| **SunkenBot v2.1** | `sv2.1` (هذا المستودع) | بوت Userbot يسجّل دخولاً لحساب فيسبوك ويتفاعل داخل المجموعات بالأوامر |
| **Sunken Bot API** | `hf-space` | خادم FastAPI موحَّد على Hugging Face Spaces يقدّم خدمات الذكاء الاصطناعي والوسائط عبر نظام plugins |

```
مستخدم في مجموعة فيسبوك
        │  (gemini, yt, chess ...)
        ▼
SunkenBot v2.1  (Node.js Userbot)
        │  HTTP POST + header: X-Internal-Token
        ▼
Sunken Bot API  (Hugging Face Space — FastAPI)
        │
        ├── Groq / Gemini / GPT-4o / Cerebras / HF Inference
        ├── تحميل فيديو فيسبوك، يوتيوب، SoundCloud
        ├── شطرنج، قرآن، روايات، ترجمة، صور...
        ▼
الرد يعود إلى البوت → يُرسل للمجموعة
```

البوت (هذا المستودع) هو الواجهة التي يتعامل معها المستخدمون مباشرة داخل فيسبوك، بينما **Hugging Face Space** يعمل كـ Backend داخلي يقدّم كل المنطق الثقيل (نماذج AI، كشط الوسائط، إلخ) عبر REST API. بعض الأوامر (`chess`, `fb`, `gemini`, `groq`, `novel2`) تستدعي هذا الـ API مباشرة؛ بقية الأوامر تعمل محلياً داخل هذا المستودع فقط.

> ℹ️ تفاصيل `hf-space` (بنية الـ plugins، الـ middleware، إلخ) موثَّقة في مستودعه الخاص — راجعها هناك مباشرة، فهذا الملف يوثّق فقط ما تم التحقق منه فعلياً في كود `sv2.1`.

---

## 🔑 لا يوجد Prefix حالياً

البوت في إعداده الحالي **لا يتطلب أي بادئة (Prefix)** قبل اسم الأمر — أي أن كتابة اسم الأمر مباشرة (مثل `help` أو `gemini سؤالك`) تكفي لتنفيذه، بشرط ألا تكون مطابقة لكلام عادي غير مقصود. هذا مضبوط عبر `"Prefix": [""]` في `config.json`.

لو أردت لاحقاً فرض بادئة (مثل `!`) لتقليل الردود العرضية على كلام الأصدقاء، غيّر القيمة في `config.json` إلى مصفوفة تحتوي رمزاً غير فارغ، مثل `["!"]` — لكن هذا **يتطلب أيضاً تعديل منطق التوجيه في `index.js`** (قسم Command routing)، فالكود الحالي لا يقرأ `Prefix` من `config.json` في التوجيه الفعلي؛ هذا قرار متعمَّد حالياً بناءً على طلب صاحب المشروع.

---

## 🔐 حماية API الداخلي بـ X-Internal-Token

نظراً لأن Hugging Face Space يُعرَّض كنقطة HTTP عامة، فإن أي شخص يعرف رابط الـ Space يستطيع نظرياً استدعاء الـ endpoints مباشرة دون المرور بالبوت. لإغلاق هذه الثغرة، كل طلب من `sv2.1` إلى `hf-space` يُرفَق تلقائياً بترويسة `X-Internal-Token`.

- **مصدر التوكن من جهة البوت**: متغيّر البيئة `INTERNAL_TOKEN` في `.env`.
- يجب أن تكون القيمة **مطابقة تماماً** لقيمة `INTERNAL_TOKEN` المضبوطة على `hf-space` (كـ Secret في إعداداته)، وإلا سترجع كل الطلبات `401 Unauthorized`.
- الأوامر التي ترسل هذا التوكن فعلياً: `commands/chess.js`, `commands/fb.js`, `commands/gemini.js`, `commands/groq.js`, `commands/novel2.js`.

نمط الإرسال المستخدَم:
```js
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || "";
axios.post(`${process.env.HF_SPACE_URL}/endpoint`, payload,
  { headers: { "Content-Type": "application/json", "X-Internal-Token": INTERNAL_TOKEN } });
```

---

## 🧩 SunkenBot v2.1 — تفاصيل هذا المستودع

بوت Node.js يعمل كـ **Userbot** داخل مجموعات فيسبوك ماسنجر عبر `@dongdev/fca-unofficial`.

> ⚠️ **تذكير**: تسجيل الدخول غير الرسمي يخالف شروط استخدام فيسبوك بحد ذاته — استخدم دائماً حساباً مخصصاً للبوت وليس حسابك الشخصي.

### أبرز حمايات هذه النسخة

- طابور إرسال (`safeSend`) عبر بوابة موحّدة (`gatedSend`) بفاصل زمني أدنى بين الرسائل المتتالية.
- كل استدعاء `api.sendMessage` يمر تلقائياً عبر `safeSend` (تغليف `api` في `index.js` عبر `wrapApiForSafety`)، حتى لو نسي أمر معيّن استخدامه صراحة.
- **Cooldown لكل مستخدم ولكل أمر** يُضبط عبر `config.countDown` في كل ملف أمر.
- **نظام صلاحيات** بـ 5 مستويات: مطوّرين (4) → VIP (3) → مشرفين كبار (2) → مشرفين (1) → الجميع (0)، مضبوط عبر `config.json` (`developers`, `vips`, `moderators`, `admins`).
- ربط `usersData`/`globalData` بـ MongoDB (اختياري عبر `MONGO_URI`) — بدونه تعمل البيانات في الذاكرة فقط بلا حفظ دائم.
- تجديد appstate تلقائي كل ساعتين وحفظه فوراً في `appstate.json`.
- تنظيف دوري كل 30 دقيقة (ردود منتهية، cooldowns منتهية، ملفات مؤقتة يتيمة).

### أبرز الأوامر (حسب الملفات الفعلية في `commands/`)

| الفئة | أمثلة |
|---|---|
| ذكاء اصطناعي | `gpt`، `gptx`، `groq`، `gemini` |
| وسائط | `yt`، `yt2`، `ydl`، `sc`، `sing`، `tts`، `pinterest`، `random`، `mf` |
| ألعاب ومحتوى | `chess`، `novel`، `novel2`، `quran`، `catfact`، `dogfact`، `manga`، `manga2` |
| أدوات عامة | `help`، `tr`، `uid`، `gid`، `profile`، `unsend` |
| إدارة (مشرفين) | `kick`، `adduser`، `up` |

القائمة الكاملة والتفصيلية لكل أمر تظهر مباشرة عبر أمر `help` داخل البوت نفسه.

---

## ⚙️ الإعداد والتشغيل

### appstate.json — جلسة الدخول

**appstate.json وحده هو مصدر جلسة الدخول** — يوضع كملف في جذر المشروع، ولا يُقرأ من أي متغيّر بيئة (`APPSTATE` غير مدعوم في الكود حالياً). هذا مقصود: appstate كنص كبير عرضة للخطأ عند تعديله داخل `.env` بجانب مفاتيح حساسة أخرى، بينما كملف مستقل يسهل استبداله دون خطر المساس بباقي الإعدادات.

إن لم يوجد `appstate.json`، يحاول البوت تسجيل الدخول احتياطياً بـ `FB_EMAIL`/`FB_PASSWORD` (ومفتاح `FB_2FA_SECRET` إن كان الحساب يستخدم التحقق بخطوتين).

### ملف .env

انسخ القائمة التالية إلى ملف باسم `.env` في جذر المشروع (وليس على تخزين مشترك/سحابي) واملأ فقط ما تحتاجه فعلاً:

| المتغيّر | الاستخدام |
|---|---|
| `FB_EMAIL` / `FB_PASSWORD` | دخول احتياطي (فقط إن غاب `appstate.json`) |
| `FB_2FA_SECRET` | مفتاح التحقق بخطوتين (اختياري) |
| `MONGO_URI` | قاعدة بيانات دائمة للمستخدمين/الجلسات (موصى بها بشدة) |
| `PORT` | منفذ خادم keep-alive المحلي (افتراضي 10000) |
| `INTERNAL_TOKEN` | يُرفق تلقائياً كـ `X-Internal-Token` عند استدعاء `hf-space` |
| `HF_SPACE_URL` | رابط Hugging Face Space الذي تستدعيه بعض الأوامر |
| `GEMINI_API_KEY` / `_2` / `_3` / `_4` | مفاتيح Gemini (تناوب عند نفاد الحصة) |
| `CEREBRAS_API_KEY` | مزوّد GPT-OSS عبر Cerebras (يُستخدم داخل `gpt.js`) |
| `GITHUB_MODELS_TOKEN` | GPT-4o عبر GitHub Models |
| `FERDEV_API_KEY` / `2` / `3` | خدمة Ferdev (بديلة لبعضها عند نفاد الحصة) |
| `GIPHY_API_KEY` | GIFs مزاجية |
| `TUMBLR_API_KEY` | محتوى عشوائي من Tumblr (`random`) |
| `RAPIDAPI_KEY` | يُستخدم في `adduser.js` و `uid.js` |
| `FB_GRAPH_ACCESS_TOKEN` | يُستخدم في `adduser.js` و `uid.js` كطريقة بديلة عبر Graph API |
| `RENDER_EXTERNAL_URL` | فقط إن كانت الاستضافة على Render (keep-alive) |

لا تضع appstate كنص داخل `.env` — استخدم ملف `appstate.json` كما هو موضّح أعلاه.

### التشغيل

```bash
npm install
# ضع appstate.json في الجذر (أو اضبط FB_EMAIL/FB_PASSWORD في .env)
# املأ .env بالقيم التي تحتاجها فعلاً
npm start          # تشغيل عادي
npm run dev         # مع hot-reload (node --watch) أثناء التطوير فقط
```

### الاستضافة

يعمل المشروع على أي بيئة تدعم Node.js LTS (22 أو 24)، سواء استضافة سحابية (مثل Render — عبر `node index.js` وضبط متغيرات البيئة من لوحة التحكم) أو استضافة محلية (مثل Termux على أندرويد، باستخدام `tmux` لإبقاء العملية في الخلفية و`termux-wake-lock` لمنع النظام من إيقافها). التفاصيل تعتمد على بيئتك تحديداً.

---

## ➕ إضافة أمر جديد

أنشئ ملفاً جديداً في `commands/`، مثلاً `commands/mycommand.js`:

```js
// commands/mycommand.js
module.exports = {
  config: {
    name: "mycommand",        // إلزامي — اسم الأمر كما يُكتب (لا يوجد Prefix حالياً)
    aliases: ["alias1"],      // اختياري — أسماء بديلة لنفس الأمر
    role: 0,                  // إلزامي — 0 = للجميع، 1 = مشرفين، 2 = مشرف كبير، 3 = VIP، 4 = مطور
    countDown: 5,             // اختياري — مهلة التبريد بالثواني بين استخدامين لنفس المستخدم
    category: "أدوات",        // اختياري — التصنيف الذي يظهر تحته في help
    description: "وصف مختصر لما يفعله الأمر",
  },

  // دالة إلزامية بهذا الاسم بالضبط: onStart
  onStart: async ({ api, event, args }) => {
    const { threadID, messageID } = event;
    // args = الكلمات بعد اسم الأمر، مثال: "mycommand مرحبا" → args = ["مرحبا"]
    await api.sendMessage("مرحباً! الأمر شغال ✅", threadID, messageID);
  }
};
```

**القواعد التي يفرضها مُحمِّل الأوامر عند القراءة:**

| العنصر | الإلزامية | الدور |
|---|---|---|
| الملف داخل `commands/*.js` | إلزامي | يُحمَّل تلقائياً عند تشغيل البوت — لا حاجة لتسجيله يدوياً في `index.js` |
| `module.exports.config.name` | إلزامي | يحدد اسم استدعاء الأمر |
| `module.exports.onStart` (أو `run` / `execute`) | إلزامي | الدالة التي تُنفَّذ عند استدعاء الأمر |
| `aliases` / `role` / `countDown` / `category` / `description` | اختياري | تحسّن تجربة `help` وتمنع إساءة الاستخدام، الأمر يعمل بدونها بإعدادات افتراضية (role: 0) |

- إن احتاج الأمر استدعاء `hf-space`، استورد `INTERNAL_TOKEN` و`HF_SPACE_URL` من البيئة وأرفقهما كما في `commands/groq.js` أو `commands/gemini.js` (راجع قسم الأمان أعلاه).
- استخدم `api.sendMessage` العادية دائماً — التغليف التلقائي في `index.js` يمرّرها عبر طابور الإرسال الآمن لحماية الحساب من الحظر.

---

## 📜 الترخيص

MIT.
