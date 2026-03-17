"use strict";
/**
 * produceVideo({ text }) → outputPath (MP4)
 * Tam üretim pipeline: TTS → Veo3 loop → ambient ses → SFX → FFmpeg render
 */
require("dotenv").config();
const path   = require("path");
const fs     = require("fs/promises");
const crypto = require("crypto");

const { generateVoiceover }                              = require("./voiceover-generator");
const { writeScriptForTTS }                              = require("./script-writer");
const { renderVideo, extractVideoAudio, generateSfxBed } = require("../ffmpeg-video-generator");
const brand    = require("../assets/brand.json");
const template = require("../templates/default-template.json");

const RENDER_BASE = process.env.ALGEONEX_RENDER_DIR || "C:/Users/Public/algeonex-render";
const _ffmpegStatic = require("ffmpeg-static");
const FFMPEG = require("fs").existsSync("/usr/bin/ffmpeg") ? "/usr/bin/ffmpeg" : _ffmpegStatic;
const TEMPLATE_BG = path.join(RENDER_BASE, "template", "bg-template.mp4");

// ── Yardımcılar ───────────────────────────────────────────────────────────────

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

// Metni 2 satıra böl — her satır MAX karakter (ekran sınırı)
function toLines(s, MAX = 16) {
  const c = (s || "").replace(/[.!?]$/, "").trim();
  if (!c) return { line1: "ALGEONEX", line2: "" };
  if (c.length <= MAX) return { line1: c, line2: "" };
  const ws = c.split(" ");
  let line1 = "";
  let split = ws.length;
  for (let i = 0; i < ws.length; i++) {
    const attempt = (line1 ? line1 + " " : "") + ws[i];
    if (attempt.length > MAX && line1 !== "") { split = i; break; }
    line1 = attempt;
  }
  let line2 = ws.slice(split).join(" ");
  if (line2.length > MAX) {
    const ws2 = line2.split(" ");
    let l2 = "";
    for (const w of ws2) {
      const t = (l2 ? l2 + " " : "") + w;
      if (t.length > MAX && l2 !== "") break;
      l2 = t;
    }
    line2 = l2;
  }
  return { line1, line2 };
}

// Metni cümlelere böl (emoji temizle)
function parseSentences(text) {
  return (text || "")
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "")
    .replace(/([!?])\s+/g, "$1\n")
    .replace(/\.\s+(?=[A-ZÇĞİÖŞÜa-zçğışöşü])/g, ".\n")
    .split("\n").map(s => s.trim()).filter(Boolean);
}

function buildScenes(totalDur, text) {
  const finale  = 1.5;
  const content = totalDur - finale;
  const h = Math.round(content * 0.18 * 10) / 10;
  const v = Math.round(content * 0.47 * 10) / 10;

  const sentences = parseSentences(text);
  const n = sentences.length;
  const hookLines  = toLines(sentences[0]);
  const valueLines = toLines(sentences[Math.max(1, Math.floor(n / 2))]);

  return [
    { id: "scene-1-hook",  start: 0,     end: h,       line1: hookLines.line1,  line2: hookLines.line2  },
    { id: "scene-2-value", start: h,     end: h + v,   line1: valueLines.line1, line2: valueLines.line2 },
    { id: "scene-3-cta",   start: h + v, end: content, line1: "Ücretsiz AI Analizi", line2: "algeonex.com" }
  ];
}

function loopVideo(inputPath, outputPath, targetDuration) {
  const srcDur = measureDuration(inputPath);
  if (srcDur <= 0) throw new Error(`Kaynak video süresi ölçülemedi: ${inputPath}`);
  const loops = Math.ceil(targetDuration / srcDur) + 1;
  console.log(`   [loopVideo] ${srcDur.toFixed(1)}s → ${loops}x → hedef ${targetDuration.toFixed(1)}s`);
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

// ── Ana fonksiyon ─────────────────────────────────────────────────────────────

/**
 * @param {string} text — Seslendirilecek reklam metni
 * @returns {Promise<string>} — Üretilen MP4 dosyasının tam yolu
 */
async function produceVideo({ text }) {
  const jobId   = `dynvid-${crypto.randomBytes(4).toString("hex")}`;
  const workDir = path.join(RENDER_BASE, "renders", jobId);
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(path.join(RENDER_BASE, "voice"), { recursive: true });

  console.log(`\n[produceVideo] Job: ${jobId}`);
  console.log(`[produceVideo] Metin: "${text.slice(0, 80)}..."`);

  // 1. GPT-4o ile TTS metni hazırla (ses üretmeden önce sahne seçimi için)
  console.log("[1/5] TTS metni hazırlanıyor...");
  const ttsText = await writeScriptForTTS(text);
  console.log(`[1/5] ✅ TTS metni: "${ttsText.slice(0, 80)}..."`);

  // 2. TAM ttsText ile ses üret — tüm metin seslendiriliyor
  console.log("[2/5] TTS sesi üretiliyor (tam metin)...");
  const voicePath = path.join(RENDER_BASE, "voice", `${jobId}.mp3`);
  await generateVoiceover({ text: ttsText, outputPath: voicePath, skipRewrite: true });
  const voiceDur = measureDuration(voicePath);
  const videoDur = Math.max(Math.ceil(voiceDur) + 2, 15);
  console.log(`[2/5] ✅ Ses: ${voiceDur.toFixed(2)}s → Video: ${videoDur.toFixed(1)}s`);

  // 3. Tüm cümleleri ses süresiyle orantılı caption'lara dönüştür
  // → her cümle ekranda tam söylendiği süre boyunca görünür
  const sentences = parseSentences(ttsText);
  const nSen = Math.max(sentences.length, 1);
  const sentenceDur = voiceDur / nSen;
  const captions = sentences.map((s, i) => {
    const { line1, line2 } = toLines(s);
    return {
      start: +(i * sentenceDur).toFixed(3),
      end:   +Math.min((i + 1) * sentenceDur, voiceDur).toFixed(3),
      line1,
      line2: line2 || "",
      accent: i === 0
    };
  });
  console.log(`[3/5] ${nSen} caption oluşturuldu: ${captions.map(c => c.line1).join(" | ")}`);

  // Sahneler — arka plan zamanlaması için (mevcut yapı korunur)
  const platform = { name: "instagram_dynamic", width: 1080, height: 1920, duration: videoDur, fps: 30 };
  const scenes   = buildScenes(videoDur, ttsText);

  const campaign = {
    voiceoverText: ttsText,
    hook: captions[0] ? `${captions[0].line1} ${captions[0].line2}`.trim() : text,
    scenes,
    captions,  // ← tüm cümleler caption olarak — renderer bunları kullanır
    textOverlay: captions.map(c => ({ start: c.start, end: c.end, text: `${c.line1}\n${c.line2}`.trim() })),
    timeline:    scenes.map(s => ({ start: s.start, end: s.end, label: s.id })),
    analysis:    { keywords: ["AI", "ALGEONEX", "büyüme", "önerilme"] }
  };

  // 4. Veo3 template'i döngüye al
  console.log("[4/5] bg.mp4 döngüye alınıyor...");
  const bgLooped = path.join(workDir, "bg.mp4");
  await loopVideo(TEMPLATE_BG, bgLooped, videoDur + 0.5);
  console.log("[4/5] ✅ bg.mp4 hazır");

  // Ambient ses (template orijinalinden)
  const musicPath = path.join(workDir, "music-bed.m4a");
  await extractVideoAudio(TEMPLATE_BG, musicPath, videoDur);
  const sfxPath = path.join(workDir, "sfx-bed.m4a");
  await generateSfxBed({ outputPath: sfxPath, duration: videoDur });

  // 5. FFmpeg render
  console.log("[5/5] Render ediliyor...");
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

  const stat = await fs.stat(videoPath);
  console.log(`[5/5] ✅ Video: ${videoPath} (${(stat.size/1024/1024).toFixed(1)} MB)`);
  return videoPath;
}

module.exports = { produceVideo };
