require("dotenv").config({ path: require("path").join(__dirname, ".env") });   // .env her zaman server.js dizininden yüklenir
const express = require("express");
const multer = require("multer");
const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const crypto = require("crypto");

const platforms = require("./config/platforms.json");
const brand = require("./assets/brand.json");
const template = require("./templates/default-template.json");
const { generateVoiceover } = require("./voice/voiceover-generator");
const { generateMusicBed, generateSfxBed, generateSunoMusic, renderVideo, resolveSceneBackgrounds, extractVideoAudio } = require("./ffmpeg-video-generator");

const app = express();
const port = process.env.PORT || 3120;
const rootDir = __dirname;

// Proje yolu "video planı/MİRALİ" gibi Unicode karakter ve boşluk içeriyor.
// FFmpeg filter_complex içindeki textfile= parametresi boşluklu/Unicode
// yollarla çalışmadığından render çıktıları ASCII-safe bir dizine yazılır.
// ALGEONEX_RENDER_DIR ortam değişkeni ile override edilebilir.
const RENDER_BASE =
  process.env.ALGEONEX_RENDER_DIR ||
  path.join(process.env.PUBLIC || "C:\\Users\\Public", "algeonex-render");

const uploadsDir = path.join(RENDER_BASE, "uploads");
const rendersDir = path.join(RENDER_BASE, "renders");
const voiceOutputDir = path.join(RENDER_BASE, "voice");
const jobs = new Map();

const stopWords = new Set([
  "ve",
  "ile",
  "icin",
  "için",
  "ama",
  "fakat",
  "gibi",
  "daha",
  "çok",
  "cok",
  "az",
  "bir",
  "bu",
  "sadece",
  "olan",
  "olanlar",
  "olarak",
  "kadar",
  "yeni",
  "hemen",
  "veya",
  "bize",
  "sizi",
  "sizin",
  "bizim",
  "marka",
  "urun",
  "ürün",
  "hizmet",
  "kendi",
  "size",
  "gore",
  "göre",
  "hem",
  "tum",
  "tüm",
  "her",
  "birlikte",
  "alan",
  "de",
  "da"
]);

function sanitizeBaseName(input) {
  return (
    input
      .normalize("NFKD")
      .replace(/[^\w.\- ]+/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase()
      .slice(0, 60) || "asset"
  );
}

function lowerFirst(text) {
  if (!text) {
    return text;
  }

  return text.charAt(0).toLocaleLowerCase("tr-TR") + text.slice(1);
}

function sentenceCase(text) {
  if (!text) {
    return text;
  }

  return text.charAt(0).toLocaleUpperCase("tr-TR") + text.slice(1);
}

function limitWords(text, wordCount) {
  return text.split(/\s+/).slice(0, wordCount).join(" ").trim();
}

function splitSentences(content) {
  return content
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractKeywords(content) {
  const normalized = content
    .toLocaleLowerCase("tr-TR")
    .replace(/[^\p{L}\p{N}\s%]/gu, " ");

  const counts = new Map();
  for (const word of normalized.split(/\s+/)) {
    if (word.length < 4 || stopWords.has(word)) {
      continue;
    }

    counts.set(word, (counts.get(word) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length)
    .slice(0, 5)
    .map(([word]) => word);
}

function extractMetrics(content) {
  const matches = new Set();
  const patterns = [
    /%\s*\d+(?:[.,]\d+)?(?:\s*[-\u2013]\s*\d+(?:[.,]\d+)?)?/g,
    /\d+(?:[.,]\d+)?\s*(?:kat|x|X)/g,
    /\d+(?:[.,]\d+)?\s*(?:gun|gün|hafta|ay|yil|yıl|adim|adım|platform)/g
  ];

  patterns.forEach((pattern) => {
    const localMatches = content.match(pattern) || [];
    localMatches.forEach((item) => matches.add(item.replace(/\s+/g, " ").trim()));
  });

  return [...matches];
}

function cleanContentLead(content) {
  const sentences = splitSentences(content);
  const lead = sentences[0] || content.trim();
  const trimmed = lead.replace(/\.$/, "").trim();
  return limitWords(trimmed, 12);
}

function integerToTurkish(input) {
  const number = Number(input);
  if (!Number.isInteger(number) || number < 0 || number > 999) {
    return String(input);
  }

  const ones = [
    "sıfır",
    "bir",
    "iki",
    "üç",
    "dört",
    "beş",
    "altı",
    "yedi",
    "sekiz",
    "dokuz"
  ];
  const tens = [
    "",
    "on",
    "yirmi",
    "otuz",
    "kırk",
    "elli",
    "altmış",
    "yetmiş",
    "seksen",
    "doksan"
  ];

  if (number < 10) {
    return ones[number];
  }

  if (number < 100) {
    const ten = Math.floor(number / 10);
    const unit = number % 10;
    return `${tens[ten]}${unit ? ` ${ones[unit]}` : ""}`.trim();
  }

  const hundred = Math.floor(number / 100);
  const rest = number % 100;
  const head = hundred === 1 ? "yüz" : `${ones[hundred]} yüz`;
  return rest ? `${head} ${integerToTurkish(rest)}` : head;
}

function metricToSpeech(metric) {
  return metric
    .replace(/%/g, "yüzde ")
    .replace(/(\d+(?:[.,]\d+)?)\s*[-\u2013]\s*(\d+(?:[.,]\d+)?)/g, "$1 ile $2")
    .replace(/(\d+(?:[.,]\d+)?)\s*[xX]\b/g, "$1 kat")
    .replace(/\d+(?:[.,]\d+)?/g, (match) => integerToTurkish(match))
    .replace(/\s+/g, " ")
    .trim();
}

function buildHook(platformKey, keyword) {
  const safeKeyword = keyword ? sentenceCase(keyword) : "AI görünürlüğü";

  switch (platformKey) {
    case "linkedin":
      return `${safeKeyword} AI sonucunda sizi önde mi gösteriyor?`;
    case "x":
      return "AI size henüz yeterince müşteri öneriyor mu?";
    case "facebook":
      return "AI çağında sadece aranmak yetmez.";
    case "instagram":
    default:
      return "AI aramada önde olmak ister misin?";
  }
}

function buildValue(platformKey, contentLead, metricA, metricB) {
  const softenedLead = contentLead
    ? lowerFirst(contentLead.replace(/^algeonex\s*/i, ""))
    : "AI görünürlüğünüzü büyütün";

  switch (platformKey) {
    case "x":
      return `ALGEONEX ile ${softenedLead}. ${metricA}, ${metricB}.`;
    default:
      return `ALGEONEX ile ${softenedLead}. ${metricA} ve ${metricB}.`;
  }
}

function buildVoiceValue(contentLead, metricA, metricB) {
  const voiceLead = limitWords(
    lowerFirst(contentLead || "AI görünürlüğünüzü büyütün").replace(
      /^algeonex\s*/i,
      ""
    ),
    6
  );

  return `ALGEONEX ile ${voiceLead}. ${metricToSpeech(metricA)} ve ${metricToSpeech(
    metricB
  )}.`;
}

function buildCta(platformKey) {
  switch (platformKey) {
    case "linkedin":
      return "Kurumsal AI analiziniz için hemen algeonex.com'u ziyaret edin.";
    case "x":
      return "Hemen algeonex.com'a gidin ve AI analizini başlatın.";
    default:
      return "Ücretsiz AI analizini almak için algeonex.com'u ziyaret edin.";
  }
}

function summarizeAnalysis(content, keywords, metrics) {
  return {
    contentLead: cleanContentLead(content),
    keywords,
    detectedMetrics: metrics,
    strengthenedAngle: "AI görünürlüğü + sayısal kanıt + net CTA"
  };
}

function createCampaignBundle({ content, platformKey }) {
  // Analiz: dashboard'daki insights paneli için kullanılır
  const keywords = extractKeywords(content);
  const metrics = extractMetrics(content);
  const analysis = summarizeAnalysis(content, keywords, metrics);

  // Dashboard'da gösterilen kampanya verileri (içerikten türetilir)
  const hook = buildHook(platformKey, keywords[0]);
  const metricA = metrics[0] || brand.proofPoints[0];
  const metricB = metrics[1] || brand.proofPoints[1];
  const valueProposition = buildValue(platformKey, analysis.contentLead, metricA, metricB);
  const cta = buildCta(platformKey);

  // ── Sabit ALGEONEX video şablonu ──────────────────────────────────────────
  //
  // SAHNE 1 (0-2s): Kullanıcının görseli · hook metni
  // SAHNE 2 (2-6s): Mavi tech efekti    · kanıt metrikleri
  // SAHNE 3 (6-10s): Karanlık dramatik  · CTA + URL
  //
  // Voiceover: Türkçe · profesyonel · hız 0.95 · teknoloji reklam tonu
  // ─────────────────────────────────────────────────────────────────────────

  const voiceoverText =
    "AI aramada lider olmak ister misin? " +
    "ALGEONEX ile yüzde beş ile on beş daha fazla AI trafiği al " +
    "ve tam beş kat daha fazla öneril. " +
    "AI çağında sadece aranmak yetmez. " +
    "Önerilen marka olman gerekir. " +
    "Ücretsiz AI analizini almak için hemen algeonex.com'u ziyaret et.";

  const scenes = [
    {
      id: "scene-1-hook",
      variant: "hook",
      start: 0,
      end: 2,
      // line1/line2 → ffmpeg-video-generator.js tarafından text dosyasına yazılır
      line1: "AI Aramada",
      line2: "Lider Sen Ol",
      overlay: "AI Aramada\nLider Sen Ol",
      subtitle: "AI aramada lider olmak ister misin?"
    },
    {
      id: "scene-2-value",
      variant: "value",
      start: 2,
      end: 6,
      line1: "%5-15 Daha Fazla AI Trafiği",
      line2: "5 Kat Daha Fazla Öneril",
      overlay: "%5-15 Daha Fazla AI Trafiği\n5 Kat Daha Fazla Öneril",
      subtitle: "ALGEONEX ile AI görünürlüğünü ve önerilme oranını artır."
    },
    {
      id: "scene-3-cta",
      variant: "cta",
      start: 6,
      end: 10,
      line1: "Ücretsiz AI Analizi",
      line2: brand.url,
      overlay: `Ücretsiz AI Analizi\n${brand.url}`,
      subtitle: "Ücretsiz AI analizini almak için hemen algeonex.com'u ziyaret et."
    }
  ];

  return {
    analysis,
    hook,
    valueProposition,
    cta,
    voiceoverText,
    textOverlay: scenes.map((sc) => ({ scene: sc.id, start: sc.start, end: sc.end, text: sc.overlay })),
    scenePlan: scenes.map((sc) => ({
      id: sc.id,
      start: sc.start,
      end: sc.end,
      purpose: sc.variant === "hook" ? "Hook" : sc.variant === "value" ? "Ana fayda + kanıt" : "CTA",
      overlay: sc.overlay,
      narration: sc.subtitle
    })),
    timeline: scenes.map((sc) => ({ start: sc.start, end: sc.end, label: sc.variant })),
    scenes
  };
}

function createJob({ platformKey, content, image }) {
  const jobId = crypto.randomUUID();
  return {
    id: jobId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "queued",
    progress: 5,
    phase: "Hazırlanıyor",
    platformKey,
    content,
    image,
    logs: [
      {
        phase: "accepted",
        message: "İstek alındı.",
        timestamp: new Date().toISOString()
      }
    ],
    result: null,
    error: null
  };
}

function updateJob(jobId, patch) {
  const current = jobs.get(jobId);
  if (!current) {
    return null;
  }

  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  };

  if (patch.logMessage) {
    next.logs = [
      ...current.logs,
      {
        phase: patch.phase || current.phase,
        message: patch.logMessage,
        timestamp: next.updatedAt
      }
    ];
  }

  delete next.logMessage;
  jobs.set(jobId, next);
  return next;
}

async function ensureDirectories() {
  await Promise.all([
    fs.mkdir(uploadsDir, { recursive: true }),
    fs.mkdir(rendersDir, { recursive: true }),
    fs.mkdir(voiceOutputDir, { recursive: true }),
    fs.mkdir(path.join(rootDir, "renders"), { recursive: true })  // uyumluluk
  ]);
}

async function readRenderIndex() {
  await ensureDirectories();
  const dirEntries = await fs.readdir(rendersDir, { withFileTypes: true });
  const manifests = [];

  for (const entry of dirEntries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const manifestPath = path.join(rendersDir, entry.name, "manifest.json");
    if (!fsSync.existsSync(manifestPath)) {
      continue;
    }

    try {
      const raw = await fs.readFile(manifestPath, "utf8");
      manifests.push(JSON.parse(raw));
    } catch {
      // Bozuk manifestler arşive alınmaz.
    }
  }

  return manifests
    .sort(
      (left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    )
    .slice(0, 12);
}

const storage = multer.diskStorage({
  destination: async (req, file, callback) => {
    try {
      await ensureDirectories();
      callback(null, uploadsDir);
    } catch (error) {
      callback(error);
    }
  },
  filename: (req, file, callback) => {
    const ext = path.extname(file.originalname || ".png") || ".png";
    const base = sanitizeBaseName(path.basename(file.originalname, ext));
    callback(null, `${Date.now()}-${base}${ext.toLowerCase()}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 15 * 1024 * 1024
  },
  fileFilter: (req, file, callback) => {
    if (!file.mimetype.startsWith("image/")) {
      callback(new Error("Sadece görsel dosyaları kabul edilir."));
      return;
    }

    callback(null, true);
  }
});

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(rootDir));
app.use("/uploads", express.static(uploadsDir));
app.use("/renders", express.static(rendersDir));
app.use("/voice/output", express.static(voiceOutputDir));

app.get("/api/platforms", (req, res) => {
  res.json({
    brand,
    platforms: Object.values(platforms)
  });
});

app.get("/api/renders", async (req, res) => {
  const renders = await readRenderIndex();
  res.json({ renders });
});

app.get("/api/jobs/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "İş bulunamadı." });
    return;
  }

  res.json(job);
});

app.post("/api/generate", upload.single("image"), async (req, res) => {
  const platformKey = req.body.platform;
  const content = (req.body.content || "").trim();

  try {
    if (!platforms[platformKey]) {
      throw new Error("Geçerli bir platform seçmelisiniz.");
    }

    if (content.length < 20) {
      throw new Error("İçerik metni en az 20 karakter olmalı.");
    }

    // Görsel opsiyonel — yoksa FFmpeg programatik arka plan üretir
    const imageData = req.file
      ? { path: req.file.path, name: req.file.filename, originalName: req.file.originalname }
      : null;

    const job = createJob({
      platformKey,
      content,
      image: imageData
    });

    jobs.set(job.id, job);
    res.status(202).json({ jobId: job.id });

    processJob(job.id).catch((error) => {
      updateJob(job.id, {
        status: "failed",
        phase: "Hata",
        progress: 100,
        error: error.message,
        logMessage: error.message
      });
    });
  } catch (error) {
    if (req.file?.path) {
      await fs.unlink(req.file.path).catch(() => {});
    }

    res.status(400).json({ error: error.message });
  }
});

async function processJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) {
    throw new Error("Job kaydı bulunamadı.");
  }

  const platform = platforms[job.platformKey];
  const workDir = path.join(rendersDir, jobId);
  // ElevenLabs MP3 üretir, SAPI WAV üretir.
  // generateVoiceover() sonucunda result.format ile hangisini ürettiğini öğreniriz.
  // Önce SAPI (WAV) path ile başlıyoruz; ElevenLabs kullanılırsa .mp3 path'e güncellenir.
  const voicePathWav = path.join(voiceOutputDir, `${jobId}.wav`);
  const voicePathMp3 = path.join(voiceOutputDir, `${jobId}.mp3`);
  const musicPath = path.join(workDir, "music-bed.m4a");
  const sfxPath   = path.join(workDir, "sfx-bed.m4a");
  // Görsel yoksa dosya adında "auto-bg" etiketi kullan
  const imageBaseName = job.image
    ? sanitizeBaseName(path.basename(job.image.originalName, path.extname(job.image.originalName)))
    : `auto-bg-${Date.now()}`;
  const renderFilename = `${job.platformKey}-${imageBaseName}.mp4`;
  const videoPath = path.join(workDir, renderFilename);

  await fs.mkdir(workDir, { recursive: true });

  updateJob(jobId, {
    status: "processing",
    phase: "Analiz",
    progress: 18,
    logMessage: "Metin analizi ve reklam yapısı oluşturuluyor."
  });

  const campaign = createCampaignBundle({
    content: job.content,
    platformKey: job.platformKey
  });

  updateJob(jobId, {
    status: "processing",
    phase: "Voiceover",
    progress: 38,
    logMessage: "Türkçe voiceover üretiliyor."
  });

  // KIE veya ElevenLabs varsa MP3 path, sadece SAPI ise WAV path kullan
  const useAudioApi = Boolean(process.env.KIE_API_KEY || process.env.ELEVENLABS_API_KEY);
  const voicePath   = useAudioApi ? voicePathMp3 : voicePathWav;

  const voiceMeta = await generateVoiceover({
    text: campaign.voiceoverText,
    outputPath: voicePath,
    culture: "tr-TR",
    rate: -2   // SAPI fallback için
  });

  // ── Step: Veo3 arka plan videoyu önceden çöz (müzik adımından önce)
  // Böylece Veo3 sesini music-bed olarak kullanabiliriz
  updateJob(jobId, {
    status: "processing",
    phase: "Veo3 Video",
    progress: 48,
    logMessage: process.env.KIE_API_KEY ? "Veo3 AI video arka plan üretiliyor..." : "Programatik arka plan hazırlanıyor."
  });

  const preResolvedBg = await resolveSceneBackgrounds({
    imagePath:  job.image ? job.image.path : null,
    kieApiKey:  process.env.KIE_API_KEY || null,
    keywords:   campaign.analysis.keywords || [],
    workingDir: workDir,
    W: platform.width,
    H: platform.height
  });

  // ── Müzik: Veo3 sesi varsa onu kullan, yoksa sine wave
  updateJob(jobId, {
    status: "processing",
    phase: "Müzik",
    progress: 62,
    logMessage: preResolvedBg.bg1IsVideo
      ? "Veo3 video sesinden müzik katmanı hazırlanıyor..."
      : "Arka plan müzik katmanı hazırlanıyor."
  });

  let musicMeta;
  if (preResolvedBg.bg1IsVideo && preResolvedBg.bg1Path) {
    // Veo3 videosunun kendi ambient sesi → music-bed
    try {
      await extractVideoAudio(preResolvedBg.bg1Path, musicPath, platform.duration);
      musicMeta = { command: "veo3-audio", selectedVoice: "Veo3 Built-in Audio" };
      console.log("[Music] Veo3 audio extracted as music bed ✓");
    } catch (err) {
      console.warn("[Music] Veo3 audio extract failed, sine fallback:", err.message);
      musicMeta = await generateMusicBed({ outputPath: musicPath, duration: platform.duration });
    }
  } else {
    musicMeta = await generateMusicBed({ outputPath: musicPath, duration: platform.duration });
  }

  updateJob(jobId, {
    status: "processing",
    phase: "SFX",
    progress: 70,
    logMessage: "Efekt sesi katmanı üretiliyor."
  });

  await generateSfxBed({
    outputPath: sfxPath,
    duration: platform.duration
  });

  updateJob(jobId, {
    status: "processing",
    phase: "Render",
    progress: 78,
    logMessage: "FFmpeg ile video render ediliyor."
  });

  const renderMeta = await renderVideo({
    imagePath:   job.image ? job.image.path : null,
    outputPath:  videoPath,
    voicePath,
    musicPath,
    sfxPath,
    campaign,
    template,
    platform,
    brand,
    workingDir:  workDir,
    kieApiKey:   process.env.KIE_API_KEY || null,
    keywords:    campaign.analysis.keywords || [],
    preResolvedBg   // ← zaten indirilen Veo3 videoyu tekrar indirme
  });

  const manifest = {
    id: jobId,
    createdAt: new Date().toISOString(),
    platform: platform.label,
    platformKey: platform.key,
    resolution: `${platform.width}x${platform.height}`,
    duration: platform.duration,
    source: {
      imageUrl: job.image ? `/uploads/${job.image.name}` : null,
      originalName: job.image ? job.image.originalName : null,
      content: job.content
    },
    outputs: {
      videoUrl: `/renders/${jobId}/${renderFilename}`,
      downloadUrl: `/renders/${jobId}/${renderFilename}`,
      voiceUrl: `/voice/output/${path.basename(voiceMeta.output || voicePath)}`,
      manifestUrl: `/renders/${jobId}/manifest.json`
    },
    campaign: {
      analysis: campaign.analysis,
      hook: campaign.hook,
      valueProposition: campaign.valueProposition,
      cta: campaign.cta,
      voiceoverText: campaign.voiceoverText,
      scenePlan: campaign.scenePlan,
      textOverlay: campaign.textOverlay,
      timeline: campaign.timeline
    },
    renderEngine: {
      mode: "ffmpeg",
      command: renderMeta.command,
      musicCommand: musicMeta.command,
      selectedVoice: voiceMeta.selectedVoice || "default"
    }
  };

  await fs.writeFile(
    path.join(workDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );

  updateJob(jobId, {
    status: "completed",
    phase: "Tamamlandı",
    progress: 100,
    result: manifest,
    logMessage: "Video hazır. Preview ve download aktif."
  });
}

app.use((error, req, res, next) => {
  if (!error) {
    next();
    return;
  }

  res.status(400).json({
    error: error.message || "İstek işlenemedi."
  });
});

ensureDirectories()
  .then(() => {
    app.listen(port, () => {
      const kieStatus = process.env.KIE_API_KEY
        ? `KIE ElevenLabs Turbo 2.5 ✓  |  Nano Banana 2 AI Background ✓`
        : (process.env.ELEVENLABS_API_KEY
            ? `ElevenLabs ✓ (voice: ${process.env.ELEVENLABS_VOICE_ID || "default"})`
            : "SAPI/Zira (KIE_API_KEY veya ELEVENLABS_API_KEY yok)");
      console.log("─────────────────────────────────────────────────");
      console.log(`  ALGEONEX AI Video Dashboard`);
      console.log(`  http://localhost:${port}`);
      console.log(`  Render dizini: ${RENDER_BASE}`);
      console.log(`  Ses + Görsel: ${kieStatus}`);
      console.log("─────────────────────────────────────────────────");
    });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
