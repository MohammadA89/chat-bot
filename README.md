<div align="center">

# CodeBot · Persian Coding Agent

**یک coding agent وب، کاملاً راست‌چین و local-first — که روی همان پروژه‌ای کار می‌کند که در VS Code یا Cursor باز کرده‌اید.**

[![License: MIT](https://img.shields.io/badge/License-MIT-7c6cf6.svg)](LICENSE)
[![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-5-646cff?logo=vite&logoColor=white)](https://vite.dev)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520-5fa04e?logo=node.js&logoColor=white)](https://nodejs.org)
[![Zero runtime deps](https://img.shields.io/badge/bridge-zero%20dependencies-34d399)](scripts/local-bridge.mjs)

<img src="docs/images/codebot-overview.png" alt="نمای رابط فارسی و راست‌چین CodeBot" width="100%">

</div>

<div dir="rtl">

**CodeBot** به سرویس‌های سازگار با **OpenAI** یا **Anthropic** وصل می‌شود، از راه یک پل امن روی `127.0.0.1` فایل‌های واقعی پروژه‌تان را می‌خواند و می‌نویسد، `build` و `test` را اجرا می‌کند، و با نشست محلی `gh` به GitHub وصل می‌شود. هیچ کلید و هیچ فایلی به سرور ما نمی‌رود — چون اصلاً سروری وجود ندارد.

## فهرست

- [چه چیزی این پروژه را متفاوت می‌کند](#چه-چیزی-این-پروژه-را-متفاوت-میکند)
- [شروع سریع](#شروع-سریع)
- [معماری](#معماری)
- [اتصال پروژه‌ی VS Code / Cursor](#اتصال-پروژهی-vs-code--cursor)
- [پنل Workspace](#پنل-workspace)
- [اختیار دستیار و دروازه‌ی تأیید](#اختیار-دستیار-و-دروازهی-تأیید)
- [ابزارهایی که مدل در اختیار دارد](#ابزارهایی-که-مدل-در-اختیار-دارد)
- [پروتکل پل محلی](#پروتکل-پل-محلی)
- [امنیت](#امنیت)
- [پروژه‌ها و حافظه](#پروژهها-و-حافظه)
- [توسعه](#توسعه)
- [ساختار پروژه](#ساختار-پروژه)
- [میان‌برها](#میانبرها)
- [نقشه‌ی راه](#نقشهی-راه)
- [مشارکت](#مشارکت)
- [مجوز](#مجوز)

## چه چیزی این پروژه را متفاوت می‌کند

| | |
| --- | --- |
| **راست‌چین واقعی** | تمام رابط، از درخت فایل تا نمای diff، برای فارسی طراحی شده — نه یک قالب LTR که آینه شده باشد |
| **local-first** | کلید API و گفتگوها فقط در مرورگر شما می‌مانند؛ پل محلی تنها روی loopback گوش می‌دهد |
| **کدنویسی واقعی** | خواندن، جستجو، glob، ساخت، ویرایش، حذف و تغییر نام فایل‌ها با محدودسازی کامل مسیر |
| **پنل Workspace** | درخت فایل، نمایش کد با هایلایت، نمای Source Control، ترمینال زنده و GitHub — کنار گفتگو و با عرض قابل تغییر |
| **دروازه‌ی تأیید** | هر تغییر واقعی پیش از اجرا با diff یا دستور دقیقش نشان داده می‌شود؛ سه حالت مطالعه، تأیید و خودگردان |
| **ترمینال و Git** | اجرای build/test با خروجی لحظه‌ای، به‌علاوه‌ی status، diff، log، شاخه‌ها، stage و commit |
| **GitHub** | تشخیص حساب `gh`، خواندن مخزن/Issue/PR و در صورت اجازه ساخت Issue، نظر و Pull Request |
| **هم‌گامی زنده** | تغییر فایل‌ها در ادیتور از راه جریان رویداد پل، بلافاصله در پنل دیده می‌شود |
| **پروژه و حافظه** | هر پروژه دستورالعمل، فایل و حافظه‌ی بلندمدت خودش را دارد که خودکار استخراج و به مدل داده می‌شود |
| **دو پروتکل** | `POST /chat/completions` (OpenAI) و `POST /messages` (Anthropic) با استریم و tool call |
| **ورودی تصویری** | تصویر را با دکمه، کشیدن و رها کردن یا `Ctrl` + `V` بفرستید؛ پیش از ارسال کوچک می‌شود و برای هر دو پروتکل به بلوک تصویر تبدیل می‌شود |
| **خروجی حرفه‌ای** | مارک‌داون کامل، جدول، بلوک کد با هایلایت و کپی، و فرمول‌های LaTeX |
| **بدون وابستگی سنگین** | پل محلی صفر وابستگی runtime دارد و فقط با Node اجرا می‌شود |

## شروع سریع

</div>

```bash
git clone https://github.com/MohammadA89/CodeBot.git
cd CodeBot
npm install
npm run dev
```

<div dir="rtl">

پیش‌نیاز: **Node 20 به بالا**.

سپس در صفحه‌ی نخست:

1. نوع سرویس را انتخاب کنید (**OpenAI سازگار** یا **Anthropic سازگار**).
2. `Base URL` را وارد کنید — اگر انتهای آن `/v1` نباشد، خودکار اضافه می‌شود.
3. کلید API را وارد کنید و روی **اتصال و دریافت مدل‌ها** بزنید.

اطلاعات اتصال فقط در `localStorage` همان مرورگر ذخیره می‌شود. اگر سرویس واقعی ندارید، با `npm run mock` یک سرور آزمایشی از هر دو پروتکل بالا بیاورید.

## معماری

</div>

```mermaid
flowchart RL
    subgraph browser["مرورگر — بدون سرور"]
        UI["رابط RTL<br/>گفتگو + پنل Workspace"]
        Harness["harness<br/>پیام سیستمی، بودجه‌ی context، حلقه‌ی ابزار"]
        Gate["دروازه‌ی تأیید<br/>plan / ask / auto"]
        UI <--> Harness
        Harness --> Gate
    end

    subgraph machine["دستگاه شما"]
        Bridge["پل محلی<br/>127.0.0.1 + Bearer token"]
        FS["فایل‌های Workspace"]
        Git["git"]
        Shell["ترمینال"]
        GH["gh CLI"]
        Bridge --> FS
        Bridge --> Git
        Bridge --> Shell
        Bridge --> GH
    end

    Model["سرویس مدل<br/>OpenAI / Anthropic"]

    Harness -- "stream + tool calls" --> Model
    Gate -- "POST /rpc" --> Bridge
    Bridge -- "SSE /events" --> UI
    FS -.- Editor["VS Code / Cursor"]
```

<div dir="rtl">

هیچ مسیری از مرورگر مستقیم به فایل‌ها وجود ندارد: همه چیز از `POST /rpc` پل عبور می‌کند، و هر متد جهش‌دهنده اول از دروازه‌ی تأیید رد می‌شود.

## اتصال پروژه‌ی VS Code / Cursor

در یک ترمینال از همین مخزن، پل محلی را با مسیر پروژه‌ی مقصد اجرا کنید:

</div>

```powershell
# فقط خواندن فایل‌ها، Git و GitHub
npm run bridge -- --workspace "/path/to/repo"

# کدنویسی و اجرای build/test
npm run bridge -- --workspace "/path/to/repo" --allow-write --allow-shell

# محیط کامل: ویرایش، ترمینال و عملیات GitHub
npm run bridge -- --workspace "/path/to/repo" --allow-all
```

<div dir="rtl">

پل، آدرس و یک Token تصادفی چاپ می‌کند. در نوار بالای چت روی «اتصال Workspace» بزنید و آن‌ها را وارد کنید؛ پنجره‌ی اتصال همین دستور را بر اساس سطح دسترسی انتخابی برایتان می‌سازد. چون فایل‌ها مستقیماً در پوشه‌ی مقصد تغییر می‌کنند، نتیجه همان لحظه در VS Code یا Cursor دیده می‌شود.

| فلگ | چه چیزی باز می‌شود |
| --- | --- |
| _بدون فلگ_ | خواندن و جستجوی Workspace، وضعیت/diff/log گیت و GitHub خواندنی |
| `--allow-write` | ساخت، بازنویسی، ویرایش دقیق، حذف و تغییر نام فایل، به‌علاوه‌ی stage و commit |
| `--allow-shell` | اجرای دستور غیرتعاملی، هم یک‌باره و هم به‌صورت job زنده با خروجی لحظه‌ای |
| `--allow-github-write` | ساخت Issue، نوشتن نظر و ساخت Pull Request از راه `gh` |
| `--allow-all` | هر سه‌ی موارد بالا |
| `--port` / `--token` | تعیین دستی پورت و توکن (پیش‌فرض: `4312` و توکن تصادفی) |

سلامت پل را هر وقت خواستید بسنجید:

</div>

```bash
npm run bridge:self-test
```

<div dir="rtl">

## پنل Workspace

بعد از اتصال، پنلی کنار گفتگو باز می‌شود که عرضش با کشیدن لبه تغییر می‌کند و ذخیره می‌ماند:

- **فایل‌ها** — درخت پروژه با بارگذاری تنبل، جستجوی متنی با شماره خط، نمایش فایل با هایلایت و دکمه‌ی «باز کردن در ادیتور» که همان فایل را روی همان خط در VS Code یا Cursor باز می‌کند.
- **تغییرات** — نمای Source Control: پیام commit، فهرست جمع‌وجور فایل‌ها با نشان تک‌حرفی `M`/`U`/`A`/`D`، گروه Staged و Changes، stage کردن تک‌فایلی و diff رنگی.
- **ترمینال** — اجرای دستور با خروجی زنده، تاریخچه‌ی دستورها و دکمه‌ی توقف.
- **GitHub** — مخزن، Pull Requestها و Issueهای باز.

## اختیار دستیار و دروازه‌ی تأیید

در تنظیمات یا پنجره‌ی اتصال، یکی از سه حالت را انتخاب می‌کنید:

| حالت | رفتار |
| --- | --- |
| **فقط مطالعه** | مدل می‌خواند و پیشنهاد می‌دهد؛ هیچ تغییری اعمال نمی‌شود |
| **با تأیید من** _(پیش‌فرض)_ | پیش از هر ویرایش، دستور یا عملیات GitHub، پنجره‌ای دقیقاً همان diff یا دستور را نشان می‌دهد |
| **خودگردان** | تغییرها بدون پرسش اعمال می‌شوند |

در حالت تأیید، diffِ ویرایش پیش از نوشتن روی دیسک با `workspace.preview` ساخته می‌شود؛ یعنی چیزی که می‌بینید دقیقاً همان چیزی است که اعمال خواهد شد. هر ابزار را می‌توانید برای ادامه‌ی همان نشست مجاز کنید.

## ابزارهایی که مدل در اختیار دارد

مجموعه‌ی ابزارها بر اساس دسترسی‌های واقعی پل ساخته می‌شود؛ چیزی که فعال نباشد اصلاً به مدل معرفی نمی‌شود.

| گروه | ابزارها |
| --- | --- |
| پروژه | `remember`، `forget`، `read_project_file`، `write_project_file` |
| گفتگو | `search_chats`، `set_chat_title` |
| خواندن Workspace | `workspace_list`، `workspace_read`، `workspace_search`، `workspace_glob`، `open_in_editor` |
| نوشتن Workspace | `workspace_create`، `workspace_write`، `workspace_edit`، `workspace_delete`، `workspace_rename` |
| Git | `git_status`، `git_diff`، `git_log`، `git_branches`، `git_stage`، `git_commit` |
| ترمینال | `terminal_run` |
| GitHub | `github_repo`، `github_issues`، `github_issue`، `github_prs`، `github_pr` |
| GitHub (نوشتنی) | `github_create_issue`، `github_comment`، `github_create_pr` |

## پروتکل پل محلی

پل یک HTTP سرویس کوچک با صفر وابستگی است. همه‌ی درخواست‌ها به `Authorization: Bearer <token>` نیاز دارند.

| مسیر | کار |
| --- | --- |
| `GET /health` | وضعیت Workspace، ادیتورهای شناسایی‌شده، Git، GitHub و دسترسی‌ها |
| `POST /rpc` | `{ "method": string, "params": object }` → `{ "ok": true, "result": … }` |
| `GET /events` | جریان SSE از تغییر فایل‌ها و خروجی زنده‌ی ترمینال |

متدها با دامنه‌ی نقطه‌دار نام‌گذاری شده‌اند: `workspace.*`، `git.*`، `shell.*`، `github.*` و `editor.open`.

## امنیت

- پل فقط روی `127.0.0.1` گوش می‌دهد و CORS را تنها برای `localhost` باز می‌کند.
- هر درخواست توکن Bearer می‌خواهد؛ توکن هر بار اجرا تصادفی ساخته می‌شود و هرگز داخل پیام‌های مدل نمی‌رود.
- هر مسیر پیش از استفاده به مسیر فیزیکی تبدیل و با ریشه‌ی Workspace مقایسه می‌شود؛ `..` و symlink به بیرون رد می‌شوند.
- نوشتن، ترمینال و عملیات نوشتنی GitHub هرکدام فلگ جداگانه دارند و بدون آن حتی به مدل معرفی نمی‌شوند.
- اندازه‌ی بدنه، اندازه‌ی فایل، خروجی دستور و مهلت اجرا همگی سقف دارند.
- کلید API فعلاً در همین مرورگر می‌ماند؛ برای استقرار میزبانی‌شده باید تماس با مدل از سمت سرور پراکسی و کلیدها رمزگذاری شوند.

> [!WARNING]
> `--allow-all` به‌علاوه‌ی حالت «خودگردان» یعنی مدل می‌تواند بدون پرسش روی دستگاه شما دستور اجرا کند. برای مخزن‌هایی که کارِ commit‌نشده دارند، حالت «با تأیید من» را نگه دارید.

## پروژه‌ها و حافظه

از نوار کناری «پروژه‌ی جدید» را بزنید، نام و دستورالعمل پروژه را بنویسید و گفتگو را شروع کنید. هر گفتگو با منوی سه‌نقطه پین یا به یک پروژه منتقل می‌شود.

هنگام هر پاسخ، harness این‌ها را به پیام سیستمی اضافه می‌کند: دستورالعمل‌های پروژه، حافظه‌ی بلندمدت، فایل‌های پروژه (بلندها بریده می‌شوند و مدل در صورت نیاز کاملش را می‌خواند) و خلاصه‌ی بخش‌های قدیمی همان گفتگو. پس از هر پاسخ هم نکات ماندگار استخراج و ذخیره می‌شوند.

با کلیک روی نام پروژه در نوار بالا، پنل پروژه باز می‌شود: کلیات، حافظه (افزودن، ویرایش و حذف با نشان «خودکار»/«دستی»)، فایل‌ها و فهرست گفتگوها.

## توسعه

</div>

```bash
npm run dev              # سرور توسعه
npm run mock             # سرور آزمایشی هر دو پروتکل روی http://localhost:8787/v1
npm run build            # تایپ‌چک + خروجی در dist/
npm run preview          # پیش‌نمایش خروجی build
npm run bridge:self-test # آزمون path jail، diff، glob، جستجو و تغییر فایل
```

<div dir="rtl">

**نکته‌ی CORS:** اپ تماماً در مرورگر اجرا می‌شود و مستقیم با سرویس شما حرف می‌زند. خطای «اتصال به سرور برقرار نشد» معمولاً یعنی سرویس، هدرهای CORS را برای دامنه‌ی این صفحه باز نکرده است.

## ساختار پروژه

</div>

```text
src/
├── App.tsx               چیدمان اصلی، مدیریت وضعیت و جریان ارسال پیام
├── types.ts              مدل داده‌ها و تنظیمات پیش‌فرض
├── lib/
│   ├── api.ts            لایه‌ی ارتباط با API و پارسر SSE برای هر دو پروتکل
│   ├── bridge.ts         کلاینت تایپ‌شده‌ی پل محلی و جریان رویدادها
│   ├── diff.ts           پارس diff یکپارچه و کمک‌تابع‌های نمایش فایل
│   ├── harness.ts        حلقه‌ی عامل، مدیریت context، ابزارها و حافظه
│   ├── tools.ts          ابزارهای Workspace، Git، GitHub و پروژه + دروازه‌ی تأیید
│   ├── storage.ts        ذخیره‌سازی در localStorage
│   ├── highlighter.ts    هایلایت کد با مجموعه‌ی محدود و سبک زبان‌ها
│   ├── languages.ts      زبان‌های ثبت‌شده در highlight.js
│   ├── images.ts         خواندن، اعتبارسنجی و کوچک‌کردن تصویرهای پیوست
│   └── utils.ts          کمک‌تابع‌ها: تاریخ فارسی، گروه‌بندی، شناسه‌ها
├── components/
│   ├── Setup.tsx         صفحه‌ی اتصال (گام اول)
│   ├── Sidebar.tsx       ناوبری: پین‌شده‌ها، پروژه‌ها و سابقه‌ی گفتگوها
│   ├── ModelPicker.tsx   انتخاب مدل
│   ├── ChatMessage.tsx   نمایش پیام
│   ├── Markdown.tsx      رندر مارک‌داون، کد و ریاضی
│   ├── Composer.tsx      کادر نوشتن پیام و پیوست تصویر
│   ├── SettingsModal.tsx تنظیمات
│   ├── ProjectModal.tsx  پنل پروژه: کلیات، حافظه، فایل‌ها و گفتگوها
│   ├── WorkspaceModal.tsx راهنمای گام‌به‌گام اتصال و سطح دسترسی
│   ├── WorkspacePanel.tsx پنل فایل‌ها، تغییرات، ترمینال و GitHub
│   ├── DiffView.tsx      نمایش diff و فایل با شماره خط
│   ├── ApprovalDialog.tsx دروازه‌ی تأیید تغییرهای واقعی
│   ├── ResizeHandle.tsx  تغییر عرض پنل‌های کناری
│   └── Welcome.tsx       صفحه‌ی خوش‌آمد
scripts/
├── mock-api.mjs          سرور آزمایشی هر دو پروتکل
└── local-bridge.mjs      پل امن محلی: فایل، Git، ترمینال، GitHub و رویدادها
```

<div dir="rtl">

## میان‌برها

| کلید | کار |
| --- | --- |
| `Enter` | ارسال پیام (قابل تغییر در تنظیمات) |
| `Shift` + `Enter` | خط جدید |
| `Ctrl` + `K` | گفتگوی جدید |
| `Ctrl` + `V` | چسباندن تصویر از کلیپ‌بورد به پیام |
| `Ctrl` + `\` | نمایش یا پنهان کردن نوار کناری |
| کشیدن لبه‌ی پنل | تغییر عرض نوار کناری و پنل Workspace |

## نقشه‌ی راه

- [ ] پراکسی سمت سرور برای کلیدهای API (استقرار میزبانی‌شده)
- [ ] بازگردانی تغییرها (undo) از داخل پنل تغییرات
- [ ] چند Workspace هم‌زمان
- [ ] پشتیبانی از `.gitignore` در جستجو و درخت فایل
- [ ] پیوست فایل و تصویر در گفتگو

## مشارکت

Issue و Pull Request خوش‌آمد است. پیش از ارسال:

1. `npm run build` باید بدون خطا رد شود (تایپ‌چک هم داخلش است).
2. اگر پل را دست زدید، `npm run bridge:self-test` را هم اجرا کنید.
3. سبک کد موجود را دنبال کنید؛ راهنمای کامل در [AGENTS.md](AGENTS.md) است.
4. متن‌های رو به کاربر فارسی طبیعی باشند؛ نام پروتکل‌ها انگلیسی می‌مانند.

## مجوز

[MIT](LICENSE) © Mohammad

</div>

---

<div align="center">

**English:** CodeBot is a local-first, fully RTL Persian coding agent for the browser. It talks to any OpenAI- or Anthropic-compatible endpoint and reaches your real project through a zero-dependency localhost bridge — path-jailed file access, git, a live terminal, and the GitHub CLI — with every mutation gated behind a diff-level approval prompt. See [AGENTS.md](AGENTS.md) for the architecture notes.

</div>
