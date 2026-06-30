# 🤖 SunkenBot — منظومة بوت متعددة الاستضافة (Render + Hugging Face)

<div align="center">

**بوت فيسبوك ماسنجر مدعوم بطبقة API موحّدة من خدمات الذكاء الاصطناعي والوسائط**

![Node.js](https://img.shields.io/badge/Node.js-22.x-green?logo=node.js)
![Python](https://img.shields.io/badge/Python-3.11-blue?logo=python)
![FastAPI](https://img.shields.io/badge/FastAPI-latest-009688?logo=fastapi)
![Render](https://img.shields.io/badge/Render-Userbot-46E3B7?logo=render)
![HuggingFace](https://img.shields.io/badge/HuggingFace-API%20Space-yellow?logo=huggingface)
![License](https://img.shields.io/badge/License-MIT-lightgrey)

</div>

---

## 📋 نظرة عامة على المنظومة

المشروع مكوَّن من **مكوّنين منفصلين يعملان معاً**، كل واحد على استضافة مختلفة:

| المكوّن | المستودع | الاستضافة | الدور |
|---|---|---|---|
| **SunkenBot v2.1** | `sv2.1` | **Render** (Node.js Web Service) | بوت Userbot يسجّل دخولاً لحساب فيسبوك ويتفاعل داخل المجموعات بالأوامر |
| **Sunken Bot API** | `hf-space` | **Hugging Face Spaces** (Docker) | خادم FastAPI موحَّد يقدّم كل خدمات الذكاء الاصطناعي والوسائط عبر نظام plugins |

```
مستخدم في مجموعة فيسبوك
        │  (.gemini, .yt, .chess ...)
        ▼
SunkenBot v2.1  (Render — Node.js Userbot)
        │  HTTP POST + header: X-Internal-Token
        ▼
Sunken Bot API  (Hugging Face Space — FastAPI)
        │
        ├── Groq / Gemini / GPT-4o / Cerebras / HF Inference
        ├── تحميل فيديو فيسبوك، يوتيوب، SoundCloud
        ├── شطرنج، قرآن، روايات، ترجمة، صور...
        ▼
الرد يعود إلى البوت على Render → يُرسل للمجموعة
```

البوت على **Render** هو الواجهة التي يتعامل معها المستخدمون مباشرة داخل فيسبوك، بينما **Hugging Face Space** يعمل كـ Backend داخلي يقدّم كل المنطق الثقيل (نماذج AI، كشط الوسائط، إلخ) عبر REST API. الفصل بين الاثنين يسمح بتحديث/توسعة كل جزء بشكل مستقل، لكنه يفرض ضرورة **تأمين القناة بينهما** — وهذا هو محور التحديث الموثّق أدناه.

---

## 🔐 تحديث الأمان: حماية API الداخلي بـ X-Internal-Token

نظراً لأن Hugging Face Space يُعرَّض كنقطة HTTP عامة (حتى لو لم يُروَّج لها)، فإن أي شخص يعرف رابط الـ Space يستطيع نظرياً استدعاء كل الـ endpoints مباشرة (نماذج AI، تحميل وسائط، إلخ) دون المرور بالبوت على Render. لإغلاق هذه الثغرة أُضيف middleware عام في طبقة FastAPI.

### كيف يعمل

- **Middleware عام بـ FastAPI** مُسجَّل على مستوى التطبيق بالكامل (`plugin_loader.py`، عبر `_register_auth_middleware`)، يتحقق من وجود الـ header **`X-Internal-Token`** على **كل طلب وارد**.
- **استثناءان فقط ومتعمَّدان**: `/` و `/health`. هذان المساران يبقيان عامّين دائماً (بلا توكن) حتى تستمر فحوصات الحالة العامة (health checks من Render/HF/أدوات المراقبة) بالعمل لأي جهة، دون أن تكشف أي معلومة حساسة أصلاً (مجرد حالة "online/healthy").
- **مصدر التوكن**: متغيّر بيئة باسم **`INTERNAL_TOKEN`** يُضبط من طرفك في:
  > **HF Space → Settings → Variables and secrets → New secret**
- **سلوك آمن افتراضياً عند عدم الضبط (Fail-Open مع تحذير)**: إذا لم تضع `INTERNAL_TOKEN` إطلاقاً، الـ middleware **لا يُسجَّل أصلاً** والخدمة تستمر بالعمل بسلوكها القديم بدون أي حماية — لكن مع تحذير صريح في الـ logs:
  ```
  ⚠️ INTERNAL_TOKEN غير مضبوط — كل الـ endpoints مفتوحة بدون حماية!
  أضف INTERNAL_TOKEN في إعدادات الـ Space (Settings → Variables and secrets).
  ```
  هذا التصميم مقصود: يمنع توقف الخدمة بالكامل (Fail-Closed) في حال نسيت ضبط المتغير قبل أول deploy، بثمن تحذير واضح بدل فشل صامت أو خدمة معطّلة بالكامل.
- **عند ضبط `INTERNAL_TOKEN`**: أي طلب على أي مسار غير المستثنيين يجب أن يحمل الـ header الصحيح، وإلا يُرفض فوراً بـ:
  ```http
  HTTP/1.1 401 Unauthorized
  Content-Type: application/json

  {"status": "error", "message": "Unauthorized — missing or invalid X-Internal-Token"}
  ```
  كل محاولة مرفوضة تُسجَّل في الـ logs مع الـ method والمسار وعنوان IP المرسِل.

### إعداد الطرفين

**1) على Hugging Face Space (الخادم):**

| المتغير | الاستخدام |
|---|---|
| `INTERNAL_TOKEN` | سرّ مشترك يتحقق منه الـ middleware على كل طلب (عدا `/` و `/health`) |

أضِفه كـ **secret** (وليس variable عادي) حتى لا يظهر قيمته في واجهة الإعدادات أو السجلات.

**2) على Render (البوت — العميل):**

| المتغير | الاستخدام |
|---|---|
| `INTERNAL_TOKEN` | نفس القيمة بالضبط الموضوعة في HF Space، يرسلها البوت تلقائياً كـ header `X-Internal-Token` مع كل طلب إلى الـ API |

البوت على جانب Render يقرأ نفس المتغيّر ويُرفقه تلقائياً عند استدعاء أي endpoint في الـ Space (مثل `/groq`, `/gemini`, `/process_move`, `/fb`, `/novel`...)، عبر:
```js
headers: { "Content-Type": "application/json", "X-Internal-Token": INTERNAL_TOKEN }
```

> ⚠️ **مهم:** التوكن يجب أن يكون **مطابقاً تماماً** على الاستضافتين. أي اختلاف (حتى مسافة زائدة) يعني أن كل طلبات البوت سترجع 401.

> 💡 إن غيّرت `INTERNAL_TOKEN` لاحقاً، حدِّثه في **كلا** الاستضافتين معاً (Render + HF Space) وأعد نشر/إعادة تشغيل الخدمتين، وإلا سينقطع الاتصال بين البوت والـ API.

---

## 🧩 1) Sunken Bot API — الخادم على Hugging Face Space

خادم API موحَّد مبني على **FastAPI**، يُنشَر كصورة **Docker** على Hugging Face Spaces ويُزامَن تلقائياً من GitHub. بنيته قائمة على نظام **plugins** قابل للتوسعة: كل ميزة هي ملف Python واحد في `plugins/` دون أي تعديل على `main.py` نفسه.

### أبرز الخدمات المتاحة عبره

- **ذكاء اصطناعي**: `/groq` (Llama 4 Scout)، `/gemini` (Gemini 2.5 Flash + Google Search Grounding)، `/gptx` (GPT-4o)، `/cerebras` (GPT-OSS)، `/hf` (20+ نموذج عبر HF Inference)
- **وسائط**: `/image` (توليد صور FLUX/SDXL)، `/pinterest` (بحث صور)، `/sing` (SoundCloud)، `/fb` (تحميل فيديو فيسبوك)، `/random` (Tumblr)، `/stickers/mood`
- **ألعاب ومحتوى**: `/process_move` (محرك شطرنج)، `/novel/*` (قراءة روايات من 5 مصادر)، `/quran`، `/translate`
- **معلومات عامة**: `/` (حالة الخادم وقائمة plugins المحمَّلة) و`/health` (فحص صحة) — **هذان فقط مستثنيان من حماية التوكن**

كل الـ endpoints الأخرى أعلاه تمر الآن إلزامياً عبر middleware التحقق من `X-Internal-Token` الموضّح في القسم السابق.

### متغيرات البيئة (HF Space → Settings → Variables and secrets)

| المتغير | الاستخدام | إلزامي؟ |
|---|---|---|
| `INTERNAL_TOKEN` | حماية كل الـ API بتوكن داخلي (راجع قسم الأمان أعلاه) | **موصى به بشدة** |
| `GROQ_API_KEY` | Llama 4 Scout + Whisper + fallback لـ Gemini | موصى به |
| `GEMINI_API_KEY` (+ `_2`/`_3`/`_4`) | Gemini 2.5 Flash مع تناوب مفاتيح | موصى به |
| `HF_TOKEN` | HuggingFace Inference + توليد الصور | لـ `/hf` و `/image` |
| `GITHUB_MODELS_TOKEN` | GPT-4o عبر GitHub Models | لـ `/gptx` |
| `CEREBRAS_API_KEY` | Cerebras GPT-OSS | لـ `/cerebras` |
| `MONGO_URI` | حفظ جلسات المحادثة | اختياري |
| `TUMBLR_API_KEY` / `GIPHY_API_KEY` / `FERDEV_API_KEY` | خدمات وسائط متفرقة | اختياري |
| `CF_WORKER_URL` | توجيه الطلبات الخارجة عبر Cloudflare Worker | اختياري |

### النشر والتشغيل

```bash
git clone https://github.com/your-username/hf-space.git
cd hf-space
cp .env.example .env   # عدّل القيم، ومنها INTERNAL_TOKEN
docker build -t sunken-bot .
docker run -p 7860:7860 --env-file .env sunken-bot
```

ينشر تلقائياً عبر GitHub Action عند كل `push` إلى `main` (`sync.yml`)، مع `keep-alive.yml` يومي لإبقاء الـ Space نشطاً.

---

## 🧩 2) SunkenBot v2.1 — البوت على Render

بوت Node.js يعمل كـ **Userbot** داخل مجموعات فيسبوك ماسنجر (عبر `@dongdev/fca-unofficial`)، وينفّذ الأوامر بالاتصال بخادم Sunken Bot API على Hugging Face.

> ⚠️ **تذكير**: تسجيل الدخول غير الرسمي يخالف شروط استخدام فيسبوك بحد ذاته — استخدم دائماً حساباً مخصصاً للبوت وليس حسابك الشخصي.

### أبرز حمايات هذه النسخة

- طابور إرسال (`safeSend`) **منفصل لكل مجموعة (threadID)** بدل طابور عام واحد.
- كل استدعاء `api.sendMessage` يمر تلقائياً عبر `safeSend` (تغليف `api` في `index.js`).
- `.adduser`: cooldown مرفوع إلى 45 ثانية + حد أقصى **8 إضافات/يوم لكل مشرف**.
- **Rate limiting عام لكل مستخدم**: 5 أوامر كحد أقصى كل 10 ثوانٍ.
- ربط فعلي لـ `usersData`/`globalData` بـ MongoDB (قراءة كسولة + كتابة دورية كل 5 دقائق)، مع إغلاق سليم (graceful shutdown) عند `SIGTERM`/`SIGINT`.
- إرسال `X-Internal-Token` تلقائياً مع كل طلب إلى الـ API على Hugging Face (راجع قسم الأمان أعلاه).

### أبرز الأوامر

| الفئة | أمثلة |
|---|---|
| ذكاء اصطناعي | `.gemini`، `.groq`، `.cerebras`، `.gptx`، `.hf` |
| وسائط | `.yt`، `.yt2`، `.ydl`، `.sc`، `.sing`، `.tts`، `.pinterest` |
| ألعاب ومحتوى | `.chess`، `.novel`، `.quran`، `.catfact`، `.random` |
| أدوات عامة | `.help`، `.tr`، `.uid`، `.gid`، `.profile` |
| إدارة (مشرفين) | `.kick`، `.adduser` |

### متغيرات البيئة (Render → Environment Variables)

| المتغير | الاستخدام |
|---|---|
| `INTERNAL_TOKEN` | نفس قيمة HF Space — يُرفق تلقائياً كـ `X-Internal-Token` مع كل طلب للـ API |
| `FB_EMAIL` / `FB_PASSWORD` / `FB_2FA_SECRET` | بيانات دخول حساب فيسبوك البوت |
| `MONGO_URI` | قاعدة بيانات لحفظ بيانات المستخدمين بشكل دائم (موصى بها بشدة) |
| `CEREBRAS_API_KEY` / `HF_SPACE_URL` / `HF_SCRAPER_URL` | الاتصال بخدمات AI على Hugging Face Space |
| `FB_GRAPH_ACCESS_TOKEN` / `RAPIDAPI_KEY` | اختياري — تحسين `.adduser` |

### النشر على Render

1. ارفع الكود على GitHub (**بدون** `.env`).
2. أنشئ Web Service جديد على [render.com](https://render.com).
3. أضف متغيرات البيئة أعلاه من **Environment Variables** (تأكد أن `INTERNAL_TOKEN` مطابق لقيمته في HF Space).
4. أمر التشغيل: `node index.js` — Node.js: `22`.

### التشغيل محلياً

```bash
npm install
cp .env.example .env   # عدّل القيم، ومنها INTERNAL_TOKEN لمطابقة HF Space
npm start
```

---

## 🗺️ مرجع سريع للمصادر

| الموضوع | أين تجده |
|---|---|
| تفاصيل كل endpoint في الـ API (أمثلة JSON كاملة) | `hf-space/README.md` |
| تفاصيل كل أمر في البوت ونظام الصلاحيات | `sv2.1/README.md` |
| كود الـ middleware الأمني | `hf-space/plugin_loader.py` (`_register_auth_middleware`) |
| استدعاء التوكن من جهة البوت | `sv2.1/commands/*.js` (مثل `groq.js`, `gemini.js`, `fb.js`, `chess.js`, `novel2.js`) |

---

## 📜 الترخيص

كلا المشروعين مرخَّصان بموجب رخصة **MIT**.
