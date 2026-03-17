"use strict";
/**
 * YENİ KAMPANYA — Yeni ses üretir, mevcut Veo3 video'yu yeniden kullanır
 * Maliyet: Sadece TTS (~$0.02), Veo3 yok ($0)
 * Kullanım: node new-campaign.js
 */
require("dotenv").config();
const path   = require("path");
const fs     = require("fs/promises");
const crypto = require("crypto");

const { generateVoiceover }                         = require("./voice/voiceover-generator");
const { renderVideo, extractVideoAudio, generateSfxBed } = require("./ffmpeg-video-generator");
const platforms = require("./config/platforms.json");
const brand     = require("./assets/brand.json");
const template  = require("./templates/default-template.json");

// ── Mevcut Veo3 video (görüntü maliyeti yok) ─────────────────────────────────
const EXISTING_BG_MP4 = "C:/Users/Public/algeonex-render/renders/24f1d10c-51e9-42a1-bdbf-adfadbfc7612/bg.mp4";

const RENDER_BASE = process.env.ALGEONEX_RENDER_DIR || "C:/Users/Public/algeonex-render";
const platform    = platforms["instagram"];
const KIE_API_KEY = process.env.KIE_API_KEY;

// ── YENİ KAMPANYA İÇERİĞİ ────────────────────────────────────────────────────
const campaign = {
  // MAX ~28 kelime = ~10 saniye Türkçe reklam temposu
  voiceoverText:
    "AI tabanlı büyüme başladı! " +
    "Rakiplerin öneriliyor, siz neredesiniz? " +
    "Yüzde beş ile on beş daha fazla AI trafiği, beş kat daha fazla önerilme. " +
    "Ücretsiz analizinizi alın. Algeonex.com.",

  hook: "AI Tabanlı Büyüme Başladı!",

  scenes: [
    { id: "scene-1-hook",  start: 0, end: 2,  purpose: "Hook",      line1: "AI Tabanlı",             line2: "Büyüme Başladı!" },
    { id: "scene-2-value", start: 2, end: 6,  purpose: "Ana fayda", line1: "Rakiplerin Öneriliyor",  line2: "Siz Neredesiniz?" },
    { id: "scene-3-cta",   start: 6, end: 10, purpose: "CTA",       line1: "Ücretsiz AI Analizi",    line2: "algeonex.com" }
  ],

  textOverlay: [
    { scene: "scene-1-hook",  start: 0, end: 2,  text: "AI Tabanlı\nBüyüme Başladı!" },
    { scene: "scene-2-value", start: 2, end: 6,  text: "Rakiplerin Öneriliyor\nSiz Neredesiniz?" },
    { scene: "scene-3-cta",   start: 6, end: 10, text: "Ücretsiz AI Analizi\nalgeonex.com" }
  ],

  timeline: [
    { start: 0, end: 2,  label: "hook" },
    { start: 2, end: 6,  label: "value" },
    { start: 6, end: 10, label: "cta" }
  ],

  analysis: { keywords: ["AI", "ALGEONEX", "önerilme", "büyüme"] }
};

// ── Ana Fonksiyon ─────────────────────────────────────────────────────────────
async function main() {
  const jobId   = `newcampaign-${crypto.randomBytes(4).toString("hex")}`;
  const workDir = path.join(RENDER_BASE, "renders", jobId);
  await fs.mkdir(workDir, { recursive: true });

  const bgDest    = path.join(workDir, "bg.mp4");
  const sfxPath   = path.join(workDir, "sfx-bed.m4a");
  const musicPath = path.join(workDir, "music-bed.m4a");
  const voicePath = path.join(RENDER_BASE, "voice", `${jobId}.mp3`);
  const videoPath = path.join(workDir, `instagram-${jobId}-${Date.now()}.mp4`);

  // 1. Yeni ses üret (KIE ElevenLabs)
  console.log("\n[1/5] 🎙️  Yeni ses üretiliyor (KIE TTS)...");
  await fs.mkdir(path.join(RENDER_BASE, "voice"), { recursive: true });
  const voiceMeta = await generateVoiceover({
    text:       campaign.voiceoverText,
    outputPath: voicePath,
    kieApiKey:  KIE_API_KEY
  });
  console.log(`[1/5] ✅ Ses hazır: ${voiceMeta.format || "mp3"}`);

  // 2. Mevcut Veo3 videoyu kopyala
  console.log("\n[2/5] 🎬  Veo3 video kopyalanıyor (maliyet $0)...");
  await fs.copyFile(EXISTING_BG_MP4, bgDest);
  console.log("[2/5] ✅ bg.mp4 hazır");

  // 3. Veo3'ün kendi sesini çıkar (music-bed)
  console.log("\n[3/5] 🎵  Veo3 ambient ses çıkarılıyor...");
  await extractVideoAudio(bgDest, musicPath, platform.duration);
  console.log("[3/5] ✅ Music-bed hazır");

  // 4. SFX üret
  console.log("\n[4/5] 🔊  SFX üretiliyor...");
  await generateSfxBed({ outputPath: sfxPath, duration: platform.duration });
  console.log("[4/5] ✅ SFX hazır");

  // 5. FFmpeg render
  console.log("\n[5/5] 🎞️  Video render ediliyor...");
  const preResolvedBg = {
    bg1Path: bgDest, bg1IsVideo: true,
    bg2Path: bgDest, bg2IsVideo: true,
    bg3Path: bgDest, bg3IsVideo: true
  };

  await renderVideo({
    imagePath:    null,
    outputPath:   videoPath,
    voicePath,
    musicPath,
    sfxPath,
    campaign,
    template,
    platform,
    brand,
    workingDir:   workDir,
    kieApiKey:    null,
    keywords:     campaign.analysis.keywords,
    preResolvedBg
  });

  console.log("\n══════════════════════════════════════════════");
  console.log("✅ YENİ KAMPANYA TAMAMLANDI!");
  console.log(`📺 Video:  http://localhost:3120/renders/${jobId}/${path.basename(videoPath)}`);
  console.log(`📁 Dosya:  ${videoPath}`);
  console.log(`🎙️  Ses:    ${voicePath}`);
  console.log("══════════════════════════════════════════════\n");

  // Kalite analizi
  const stat = await fs.stat(videoPath);
  const sizeMB = (stat.size / 1024 / 1024).toFixed(1);
  console.log("📊 KALİTE ANALİZİ:");
  console.log(`   Boyut: ${sizeMB} MB`);
  console.log(`   Platform: Instagram Portrait 1080×1920`);
  console.log(`   Süre: ${platform.duration}s`);
  console.log(`   Sahneler: Hook(0-2s) → Değer(2-6s) → CTA(6-10s)`);
  console.log(`   Ses: Veo3 ambient + KIE TTS voice + SFX`);
}

main().catch(err => {
  console.error("\n❌ Hata:", err.message);
  process.exit(1);
});
