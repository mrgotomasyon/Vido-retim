# Telegram Bot + Coolify Deploy Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan.

**Goal:** Telegram botu üzerinden metin alıp otomatik video üreten, Coolify'da Docker olarak çalışan bir sistem kurmak.

**Architecture:** Kullanıcı Telegram'dan metin gönderir → Express webhook sunucusu mesajı alır → `produce-video.js` KIE TTS + Veo3 loop + FFmpeg render çalıştırır → video Telegram'a gönderilir. Coolify GitHub repo'dan otomatik deploy eder, persistent volume `/data` içindeki render çıktılarını ve bg-template'i saklar.

**Tech Stack:** Node.js 20, node-telegram-bot-api, Express, ffmpeg-static, KIE.AI API, Docker (node:20-slim), Coolify (self-hosted), GitHub

---

## Dosya Haritası

| Dosya | İşlevi |
|-------|--------|
| `lib/auto-captions.js` | **YENİ** — Metni cümlelere böler, her cümleye kelime-oranıyla timing atar |
| `lib/produce-video.js` | **YENİ** — `full-production.js` mantığı fonksiyon olarak, `{ text }` alır |
| `telegram-bot.js` | **YENİ** — Express webhook sunucusu, Telegram mesajlarını işler |
| `startup.js` | **YENİ** — Container başlarken bg-template kontrol + generate |
| `Dockerfile` | **YENİ** — node:20-slim, ffmpeg-static uyumlu |
| `.dockerignore` | **YENİ** — node_modules, renders, .env |
| `.gitignore` | **YENİ/GÜNCELLE** — node_modules, .env, renders, voice |
| `package.json` | **GÜNCELLE** — node-telegram-bot-api ekle, start script |
| `full-production.js` | **KORUYUN** — standalone çalışmaya devam eder |

---

## Task 1: lib/auto-captions.js — Metin → Caption Dizisi

**Files:**
- Create: `lib/auto-captions.js`

Rastgele metni cümlelere böler, her cümle için `{ start, end, line1, line2, accent }` üretir.
Aynı PAUSE modelini kullanır (cümle sonu = 0.35s pause).

- [ ] **Adım 1: Dosyayı oluştur**

```js
"use strict";
/**
 * Auto-captions: Rastgele metni cümlelere bölerek caption dizisi üretir.
 * Her cümle kelime sayısına oranla ekranda kalır + cümle sonunda 0.35s pause.
 */

const PAUSE       = 0.35;   // TTS cümle sonu doğal duraklaması
const GAP         = 0.10;   // caption sonu ile bir sonrakinin başı arası boşluk
const MAX_LINE_LEN = 22;    // tek satır maksimum karakter

/**
 * Metni cümlelere ayırır: !, ?, . ile biter.
 * "algeonex.com" gibi domain'leri bölmez (nokta+boşluk+büyük harf kuralı).
 */
function splitSentences(text) {
  // !, ? → her zaman cümle sonu
  // .    → sadece ardından boşluk + büyük harf veya string sonu geliyorsa
  const raw = text
    .replace(/([!?])\s+/g, "$1\n")
    .replace(/\.\s+(?=[A-ZÇĞİÖŞÜa-zçğışöşü])/g, ".\n")
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);
  return raw;
}

/**
 * Cümleyi 2 satıra böler: ilk yarı → line1, ikinci yarı → line2.
 * Kısa cümleler (≤MAX_LINE_LEN) sadece line1 olur.
 */
function splitLines(sentence) {
  // Noktalama temizle (ekranda gösterim için)
  const clean = sentence.replace(/[.!?]$/, "").trim();
  if (clean.length <= MAX_LINE_LEN) return { line1: clean, line2: "" };

  const words = clean.split(" ");
  const mid   = Math.ceil(words.length / 2);
  return {
    line1: words.slice(0, mid).join(" "),
    line2: words.slice(mid).join(" ")
  };
}

/**
 * Ana fonksiyon.
 * @param {string} text   — TTS metninin tamamı
 * @param {number} voiceDur — sesin gerçek süresi (saniye)
 * @returns {{ start, end, line1, line2, accent }[]}
 */
function buildAutoCaptions(text, voiceDur) {
  const sentences = splitSentences(text);
  if (!sentences.length) return [];

  // Her cümlenin kelime sayısını hesapla
  const phrases = sentences.map((s, i) => {
    const words = s.trim().split(/\s+/).length;
    const { line1, line2 } = splitLines(s);
    return {
      w:      words,
      pause:  true,              // her cümle sonunda pause var
      line1,
      line2,
      accent: i === 0 || i === sentences.length - 1  // ilk ve son vurgulu
    };
  });

  const totalW      = phrases.reduce((s, p) => s + p.w, 0);
  const totalPauses = phrases.length * PAUSE;       // her cümle pause'lu
  const wordTime    = Math.max(voiceDur - totalPauses, voiceDur * 0.7);
  const secPerWord  = wordTime / totalW;
  let t = 0;

  return phrases.map(p => {
    const pDur = p.w * secPerWord;
    const cap = {
      start:  +Math.max(t, 0).toFixed(2),
      end:    +(t + pDur - GAP).toFixed(2),
      line1:  p.line1,
      line2:  p.line2,
      accent: p.accent
    };
    t += pDur + PAUSE;
    return cap;
  });
}

module.exports = { buildAutoCaptions };
```

- [ ] **Adım 2: Hızlı test**

```bash
node -e "
const { buildAutoCaptions } = require('./lib/auto-captions');
const text = 'AI tabanlı büyüme başladı! Rakiplerin öneriliyor olabilir. Siz hâlâ sadece arama sonuçlarında mısınız? Ücretsiz analizinizi alın. Algeonex.com.';
const caps = buildAutoCaptions(text, 15);
caps.forEach((c,i) => console.log(i+1, c.start+'s→'+c.end+'s', '|', c.line1, '/', c.line2));
"
```

Beklenen: 5 satır, süreler toplamda ~15s

---

## Task 2: lib/produce-video.js — Tek Fonksiyon ile Video Üretimi

**Files:**
- Create: `lib/produce-video.js`

`full-production.js`'in tüm mantığını `produceVideo({ text })` fonksiyonuna taşır.
Telegram botu bu fonksiyonu çağırır.

- [ ] **Adım 1: Dosyayı oluştur**

```js
"use strict";
/**
 * produceVideo({ text }) → outputPath
 * Tam üretim pipeline'ı: TTS → loop → ses → sfx → render
 */
require("dotenv").config();
const path   = require("path");
const fs     = require("fs/promises");
const crypto = require("crypto");

const { generateVoiceover }                              = require("../voice/voiceover-generator");
const { renderVideo, extractVideoAudio, generateSfxBed } = require("../ffmpeg-video-generator");
const { buildAutoCaptions }                              = require("./auto-captions");
const brand    = require("../assets/brand.json");
const template = require("../templates/default-template.json");

const RENDER_BASE = process.env.ALGEONEX_RENDER_DIR || "C:/Users/Public/algeonex-render";
const KIE_API_KEY = process.env.KIE_API_KEY;
const FFMPEG      = require("ffmpeg-static");

// Arka plan template — Linux path veya Windows path
const TEMPLATE_BG = path.join(RENDER_BASE, "template", "bg-template.mp4");

function measureDuration(filePath) {
  try {
    const { spawnSync } = require("child_process");
    const result = spawnSync(FFMPEG, ["-i", filePath], { encoding: "utf8" });
    const stderr = result.stderr || "";
    const match  = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
    if (!match) return 0;
    return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
  } catch { return 0; }
}

function buildScenes(totalDur) {
  const finale  = 1.5;
  const content = totalDur - finale;
  const h  = Math.round(content * 0.18 * 10) / 10;
  const v  = Math.round(content * 0.47 * 10) / 10;
  return [
    { id: "scene-1-hook",  start: 0,     end: h,       line1: "AI Tabanlı",           line2: "Büyüme Başladı!" },
    { id: "scene-2-value", start: h,     end: h + v,   line1: "Rakiplerin Öneriliyor",line2: "Siz Neredesiniz?" },
    { id: "scene-3-cta",   start: h + v, end: content, line1: "Ücretsiz AI Analizi",  line2: "algeonex.com" }
  ];
}

async function loopVideo(inputPath, outputPath, targetDuration) {
  const srcDur = measureDuration(inputPath);
  const loops  = Math.ceil(targetDuration / srcDur) + 1;
  return new Promise((resolve, reject) => {
    const { execFile } = require("child_process");
    execFile(FFMPEG, [
      "-y",
      "-stream_loop", String(loops),
      "-i", inputPath,
      "-t", String(targetDuration),
      "-vf", "setpts=PTS-STARTPTS",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18",
      "-an",
      outputPath
    ], (err) => err ? reject(err) : resolve(outputPath));
  });
}

/**
 * Ana üretim fonksiyonu.
 * @param {string} text — Seslendirilecek ve altyazı için kullanılacak metin
 * @returns {Promise<string>} — Üretilen MP4 dosyasının tam yolu
 */
async function produceVideo({ text }) {
  const jobId   = `tgvid-${crypto.randomBytes(4).toString("hex")}`;
  const workDir = path.join(RENDER_BASE, "renders", jobId);
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(path.join(RENDER_BASE, "voice"), { recursive: true });

  // 1. TTS
  const voicePath = path.join(RENDER_BASE, "voice", `${jobId}.mp3`);
  await generateVoiceover({ text, outputPath: voicePath, kieApiKey: KIE_API_KEY });
  const voiceDur  = measureDuration(voicePath);
  const videoDur  = Math.ceil(voiceDur) + 1.5;

  // 2. Platform
  const platform = { name: "instagram_dynamic", width: 1080, height: 1920, duration: videoDur, fps: 30 };

  // 3. Sahneler + captions
  const scenes   = buildScenes(videoDur);
  const captions = buildAutoCaptions(text, voiceDur);

  const campaign = {
    voiceoverText: text,
    hook: scenes[0].line1 + " " + scenes[0].line2,
    scenes,
    captions,
    textOverlay: scenes.map(s => ({ scene: s.id, start: s.start, end: s.end, text: `${s.line1}\n${s.line2}` })),
    timeline:    scenes.map(s => ({ start: s.start, end: s.end, label: s.id })),
    analysis: { keywords: ["AI", "ALGEONEX", "büyüme", "önerilme"] }
  };

  // 4. Veo3 döngü
  const bgLooped  = path.join(workDir, "bg.mp4");
  await loopVideo(TEMPLATE_BG, bgLooped, videoDur + 0.5);

  // 5. Ambient ses (orijinalden)
  const musicPath = path.join(workDir, "music-bed.m4a");
  await extractVideoAudio(TEMPLATE_BG, musicPath, videoDur);

  // 6. SFX
  const sfxPath = path.join(workDir, "sfx-bed.m4a");
  await generateSfxBed({ outputPath: sfxPath, duration: videoDur });

  // 7. Render
  const videoPath = path.join(workDir, `instagram-${jobId}.mp4`);
  const preResolvedBg = {
    bg1Path: bgLooped, bg1IsVideo: true,
    bg2Path: bgLooped, bg2IsVideo: true,
    bg3Path: bgLooped, bg3IsVideo: true
  };

  await renderVideo({
    imagePath: null, outputPath: videoPath, voicePath,
    musicPath, sfxPath, campaign, template, platform, brand,
    workingDir: workDir, kieApiKey: null,
    keywords: campaign.analysis.keywords, preResolvedBg
  });

  return videoPath;
}

module.exports = { produceVideo };
```

- [ ] **Adım 2: Sözdizimi kontrolü**

```bash
node -e "require('./lib/produce-video'); console.log('OK')"
```

Beklenen: `OK` (hata yok)

---

## Task 3: telegram-bot.js — Webhook Sunucusu

**Files:**
- Create: `telegram-bot.js`

- [ ] **Adım 1: node-telegram-bot-api kur**

```bash
cd "c:/Users/MİRALİ/Downloads/video planı/project" && npm install node-telegram-bot-api
```

- [ ] **Adım 2: telegram-bot.js oluştur**

```js
"use strict";
require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express     = require("express");
const path        = require("path");
const fs          = require("fs/promises");
const { produceVideo } = require("./lib/produce-video");

const TOKEN        = process.env.TELEGRAM_TOKEN;
const WEBHOOK_URL  = process.env.WEBHOOK_URL;   // https://your-coolify-domain.com
const PORT         = process.env.PORT || 3000;
const RENDER_BASE  = process.env.ALGEONEX_RENDER_DIR || "C:/Users/Public/algeonex-render";

if (!TOKEN) throw new Error("TELEGRAM_TOKEN env var gerekli!");

// ── Bot başlat ────────────────────────────────────────────────────────────────
let bot;
if (WEBHOOK_URL) {
  // Production: webhook modu
  bot = new TelegramBot(TOKEN, { webHook: false });
} else {
  // Dev: polling modu
  bot = new TelegramBot(TOKEN, { polling: true });
  console.log("[Bot] Polling modu aktif (dev)");
}

// ── Yardımcı: her 4s upload_video action gönder ───────────────────────────────
function keepTyping(chatId, intervalRef) {
  bot.sendChatAction(chatId, "upload_video").catch(() => {});
  intervalRef.id = setInterval(() => {
    bot.sendChatAction(chatId, "upload_video").catch(() => {});
  }, 4000);
}
function stopTyping(intervalRef) {
  if (intervalRef.id) clearInterval(intervalRef.id);
}

// ── Mesaj işleyici ─────────────────────────────────────────────────────────────
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text   = (msg.text || "").trim();

  // Komut mı?
  if (text.startsWith("/start") || text.startsWith("/help")) {
    return bot.sendMessage(chatId,
      "🎬 *ALGEONEX Video Üretici*\n\n" +
      "Seslendirilecek reklam metnini gönder.\n" +
      "~2-3 dakika içinde Instagram videosu gelir.\n\n" +
      "📝 _Örnek:_\n" +
      "AI tabanlı büyüme başladı! Rakiplerin öneriliyor. Ücretsiz analizinizi alın. Algeonex.com.",
      { parse_mode: "Markdown" }
    );
  }

  if (!text || text.length < 10) {
    return bot.sendMessage(chatId, "⚠️ Lütfen en az 10 karakterlik bir metin gönder.");
  }

  // Üretim başlasın
  await bot.sendMessage(chatId, "⏳ *Video üretiliyor...* (~2-3 dakika)\n\nMetniniz işleniyor, lütfen bekleyin.", { parse_mode: "Markdown" });

  const typingRef = {};
  keepTyping(chatId, typingRef);

  try {
    const videoPath = await produceVideo({ text });
    stopTyping(typingRef);

    const stat = await fs.stat(videoPath);
    const mb   = (stat.size / 1024 / 1024).toFixed(1);

    await bot.sendVideo(chatId, videoPath, {
      caption:    `✅ *Video hazır!* (${mb} MB)\n📱 1080×1920 @ 30fps\n\n_ALGEONEX AI Video Üretici_`,
      parse_mode: "Markdown",
      supports_streaming: true
    });

  } catch (err) {
    stopTyping(typingRef);
    console.error("[Bot] Üretim hatası:", err.message);
    await bot.sendMessage(chatId,
      `❌ *Üretim başarısız:*\n\`${err.message.slice(0, 200)}\`\n\nTekrar dene.`,
      { parse_mode: "Markdown" }
    );
  }
});

// ── Express + Webhook ─────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// Telegram webhook endpoint
const WEBHOOK_PATH = `/webhook/${TOKEN}`;
app.post(WEBHOOK_PATH, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Health check
app.get("/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

// Render dosyası serve et (opsiyonel)
app.use("/renders", express.static(path.join(RENDER_BASE, "renders")));

app.listen(PORT, async () => {
  console.log(`[Bot] Sunucu port ${PORT}'de başladı`);

  if (WEBHOOK_URL) {
    const url = `${WEBHOOK_URL}${WEBHOOK_PATH}`;
    await bot.setWebHook(url);
    console.log(`[Bot] Webhook kuruldu: ${url}`);
  }
});
```

- [ ] **Adım 3: Yerel polling test (opsiyonel)**

`.env` dosyasına `TELEGRAM_TOKEN=...` ekle, `WEBHOOK_URL` yorum satırı yap:
```bash
node telegram-bot.js
```
Bot'a `/start` gönder → cevap gelmeli.

---

## Task 4: startup.js — Container Başlangıç Scripti

**Files:**
- Create: `startup.js`

Container başladığında bg-template.mp4 yoksa üretir, sonra bot sunucusunu başlatır.

- [ ] **Adım 1: Dosyayı oluştur**

```js
"use strict";
require("dotenv").config();
const path = require("path");
const fs   = require("fs/promises");
const { execFileSync } = require("child_process");

const RENDER_BASE = process.env.ALGEONEX_RENDER_DIR || "/data/renders";
const TEMPLATE    = path.join(RENDER_BASE, "template", "bg-template.mp4");

async function ensureTemplate() {
  try {
    await fs.access(TEMPLATE);
    console.log("[Startup] bg-template.mp4 mevcut ✅");
  } catch {
    console.log("[Startup] bg-template.mp4 bulunamadı, üretiliyor... (~5-8 dk)");
    await fs.mkdir(path.dirname(TEMPLATE), { recursive: true });
    execFileSync("node", ["generate-template-bg.js"], { stdio: "inherit" });
    console.log("[Startup] bg-template.mp4 hazır ✅");
  }
}

async function main() {
  await ensureTemplate();
  console.log("[Startup] Telegram bot başlatılıyor...");
  require("./telegram-bot");
}

main().catch(err => {
  console.error("[Startup] Kritik hata:", err);
  process.exit(1);
});
```

---

## Task 5: Dockerfile + .dockerignore

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Adım 1: Dockerfile oluştur**

```dockerfile
FROM node:20-slim

# ffmpeg-static'in ihtiyaç duyduğu kütüphaneler
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Bağımlılıkları önce kopyala (layer cache)
COPY package*.json ./
RUN npm ci --omit=dev

# Uygulama dosyaları
COPY . .

# Render dizini (volume mount edilecek)
RUN mkdir -p /data/renders /data/voice

EXPOSE 3000

CMD ["node", "startup.js"]
```

- [ ] **Adım 2: .dockerignore oluştur**

```
node_modules
.env
.env.*
renders
voice
*.mp4
*.jpg
*.jpeg
*.png
*.log
.claude
.playwright-mcp
frame_*.jpg
dashboard-state.*
tech-demo.*
video-preview.*
docs
```

- [ ] **Adım 3: package.json scripts güncelle**

`package.json` içinde `scripts.start`'ı `"node startup.js"` yap.

---

## Task 6: .gitignore + GitHub Push

**Files:**
- Create/Update: `.gitignore`

- [ ] **Adım 1: .gitignore oluştur**

```
node_modules/
.env
.env.local
renders/
voice/
*.mp4
*.jpg
*.jpeg
*.png
*.log
frame_*.jpg
dashboard-state.*
tech-demo.*
video-preview.*
.claude/
.playwright-mcp/
832db7e7*.mp4
```

- [ ] **Adım 2: git init + remote ekle**

```bash
cd "c:/Users/MİRALİ/Downloads/video planı/project"
git init
git remote add origin https://github.com/mrgotomasyon/Vido-retim.git
```

- [ ] **Adım 3: .env.example güncelle**

```env
# KIE.AI API Key (TTS + Veo3 için)
KIE_API_KEY=your_kie_api_key_here

# Telegram Bot Token
TELEGRAM_TOKEN=your_telegram_bot_token_here

# Webhook URL (production'da Coolify public URL)
# WEBHOOK_URL=https://your-app.coolify-domain.com

# Render dizini (container içinde /data/renders)
ALGEONEX_RENDER_DIR=/data/renders

# Port
PORT=3000
```

- [ ] **Adım 4: İlk commit + push**

```bash
git add .
git commit -m "feat: Telegram bot + Docker deploy yapısı"
git branch -M main
git push -u origin main
```

---

## Task 7: Coolify Deployment

Coolify URL: http://168.231.108.246:8000
Telegram Token: `8226040967:AAFMWtERaqSnw3JrenQg5XVFtr756D8LEnc`

- [ ] **Adım 1: Coolify'a bağlan (Playwright)**

http://168.231.108.246:8000 adresine git, admin panelini bul.

- [ ] **Adım 2: Yeni proje oluştur**

Dashboard → "New Project" → isim: `algeonex-video`

- [ ] **Adım 3: GitHub repo bağla**

Add Resource → Application → Docker Compose veya Dockerfile deploy
GitHub URL: `https://github.com/mrgotomasyon/Vido-retim`
Branch: `main`
Build Method: `Dockerfile`

- [ ] **Adım 4: Environment Variables gir**

Coolify → App Settings → Environment Variables:
```
KIE_API_KEY=<kullanıcının gerçek KIE key'i>
TELEGRAM_TOKEN=8226040967:AAFMWtERaqSnw3JrenQg5XVFtr756D8LEnc
ALGEONEX_RENDER_DIR=/data/renders
PORT=3000
WEBHOOK_URL=<Coolify'ın atadığı URL>
```

- [ ] **Adım 5: Persistent Volume ekle**

Storage → `/data/renders` → persistent volume
(bg-template ve render çıktıları korunur, container restart'ta kaybolmaz)

- [ ] **Adım 6: Deploy**

Deploy → logs izle → `[Startup] Telegram bot başlatılıyor...` görünmeli

- [ ] **Adım 7: Webhook URL'i .env'e yaz + redeploy**

Coolify'ın atadığı public URL'i `WEBHOOK_URL` env var olarak güncelle → redeploy

- [ ] **Adım 8: Test**

Telegram'da bot'a `/start` gönder → cevap gelmeli
Bir metin gönder → 2-3 dakika → video gelmeli

---

## Gereksinimler

### Kullanıcıdan gerekenler:
1. **Coolify admin şifresi** (veya API token) — http://168.231.108.246:8000 için
2. **GitHub repo token** — private repo ise (public ise gerekmez)
3. **KIE_API_KEY** (gerçek değer) — .env'den alınacak

### Notlar:
- Telegram 50MB limit — 24s video ~35MB → OK
- İlk deploy'da bg-template üretimi ~5-8 dakika sürer (tek seferlik)
- Sonraki deploylarda persistent volume'dan kullanılır
- Render dosyaları `/data/renders`'da birikir — periyodik temizlik önerilebilir
