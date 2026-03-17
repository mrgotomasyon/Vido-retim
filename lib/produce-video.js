"use strict";
/**
 * produceVideo({ text }) → outputPath (MP4)
 * Tam üretim pipeline: TTS → Veo3 loop → ambient ses → SFX → FFmpeg render
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

function buildScenes(totalDur) {
  const finale  = 1.5;
  const content = totalDur - finale;
  const h = Math.round(content * 0.18 * 10) / 10;
  const v = Math.round(content * 0.47 * 10) / 10;
  return [
    { id: "scene-1-hook",  start: 0,     end: h,       line1: "AI Tabanlı",            line2: "Büyüme Başladı!" },
    { id: "scene-2-value", start: h,     end: h + v,   line1: "Rakiplerin Öneriliyor", line2: "Siz Neredesiniz?" },
    { id: "scene-3-cta",   start: h + v, end: content, line1: "Ücretsiz AI Analizi",   line2: "algeonex.com" }
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
  const jobId   = `tgvid-${crypto.randomBytes(4).toString("hex")}`;
  const workDir = path.join(RENDER_BASE, "renders", jobId);
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(path.join(RENDER_BASE, "voice"), { recursive: true });

  console.log(`\n[produceVideo] Job: ${jobId}`);
  console.log(`[produceVideo] Metin: "${text.slice(0, 80)}..."`);

  // 1. TTS sesi üret
  console.log("[1/5] TTS sesi üretiliyor...");
  const voicePath = path.join(RENDER_BASE, "voice", `${jobId}.mp3`);
  await generateVoiceover({ text, outputPath: voicePath, kieApiKey: KIE_API_KEY });
  const voiceDur = measureDuration(voicePath);
  const videoDur = Math.ceil(voiceDur) + 1.5;
  console.log(`[1/5] ✅ Ses: ${voiceDur.toFixed(2)}s → Video: ${videoDur.toFixed(1)}s`);

  // 2. Sahneler + auto-captions
  const platform = { name: "instagram_dynamic", width: 1080, height: 1920, duration: videoDur, fps: 30 };
  const scenes   = buildScenes(videoDur);
  const captions = buildAutoCaptions(text, voiceDur);
  console.log(`[2/5] ${captions.length} caption oluşturuldu`);

  const campaign = {
    voiceoverText: text,
    hook: `${scenes[0].line1} ${scenes[0].line2}`,
    scenes,
    captions,
    textOverlay: scenes.map(s => ({ scene: s.id, start: s.start, end: s.end, text: `${s.line1}\n${s.line2}` })),
    timeline:    scenes.map(s => ({ start: s.start, end: s.end, label: s.id })),
    analysis:    { keywords: ["AI", "ALGEONEX", "büyüme", "önerilme"] }
  };

  // 3. Veo3 template'i döngüye al
  console.log("[3/5] bg.mp4 döngüye alınıyor...");
  const bgLooped = path.join(workDir, "bg.mp4");
  await loopVideo(TEMPLATE_BG, bgLooped, videoDur + 0.5);
  console.log("[3/5] ✅ bg.mp4 hazır");

  // 4. Ambient ses (template orijinalinden)
  console.log("[4/5] Ambient ses çıkarılıyor...");
  const musicPath = path.join(workDir, "music-bed.m4a");
  await extractVideoAudio(TEMPLATE_BG, musicPath, videoDur);
  const sfxPath = path.join(workDir, "sfx-bed.m4a");
  await generateSfxBed({ outputPath: sfxPath, duration: videoDur });
  console.log("[4/5] ✅ Ses hazır");

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
