"use strict";
/**
 * LOCAL RE-RENDER — API çağrısı yok, ücret yok
 * Mevcut bg.mp4 + voice.mp3 kullanarak yeniden render eder
 * Kullanım: node rerender-local.js
 */
require("dotenv").config();
const path  = require("path");
const fs    = require("fs/promises");
const crypto = require("crypto");

const { renderVideo, extractVideoAudio, generateSfxBed } = require("./ffmpeg-video-generator");
const platforms = require("./config/platforms.json");
const brand     = require("./assets/brand.json");
const template  = require("./templates/default-template.json");

// ── Mevcut dosyalar ──────────────────────────────────────────────────────────
const EXISTING_BG_MP4   = "C:/Users/Public/algeonex-render/renders/24f1d10c-51e9-42a1-bdbf-adfadbfc7612/bg.mp4";
const EXISTING_VOICE_MP3 = "C:/Users/Public/algeonex-render/voice/24f1d10c-51e9-42a1-bdbf-adfadbfc7612.mp3";

const RENDER_BASE = process.env.ALGEONEX_RENDER_DIR || "C:/Users/Public/algeonex-render";
const platform    = platforms["instagram"];

// ── Campaign (son test ile aynı içerik) ─────────────────────────────────────
const campaign = {
  voiceoverText: "AI aramada lider olmak ister misin? ALGEONEX ile yüzde beş ile on beş daha fazla AI trafiği al ve tam beş kat daha fazla öneril. AI çağında sadece aranmak yetmez. Önerilen marka olman gerekir. Ücretsiz AI analizini almak için hemen algeonex.com'u ziyaret et.",
  hook: "AI aramada önde olmak ister misin?",
  scenes: [
    { id: "scene-1-hook",  start: 0, end: 2,  purpose: "Hook",           overlay: "AI Aramada\nLider Sen Ol" },
    { id: "scene-2-value", start: 2, end: 6,  purpose: "Ana fayda",      overlay: "%5-15 Daha Fazla\nAI Trafiği" },
    { id: "scene-3-cta",   start: 6, end: 10, purpose: "CTA",            overlay: "Ücretsiz AI Analizi\nalgeonex.com" }
  ],
  textOverlay: [
    { scene: "scene-1-hook",  start: 0, end: 2,  text: "AI Aramada\nLider Sen Ol" },
    { scene: "scene-2-value", start: 2, end: 6,  text: "%5-15 Daha Fazla\nAI Trafiği" },
    { scene: "scene-3-cta",   start: 6, end: 10, text: "Ücretsiz AI Analizi\nalgeonex.com" }
  ],
  timeline: [
    { start: 0, end: 2,  label: "hook" },
    { start: 2, end: 6,  label: "value" },
    { start: 6, end: 10, label: "cta" }
  ],
  analysis: { keywords: ["AI", "ALGEONEX", "trafiği", "önerilme"] }
};

async function main() {
  const jobId  = `local-${crypto.randomBytes(4).toString("hex")}`;
  const workDir = path.join(RENDER_BASE, "renders", jobId);
  await fs.mkdir(workDir, { recursive: true });

  // ── Dosyaları workDir'e link/kopyala ──────────────────────────────────────
  const bgDest    = path.join(workDir, "bg.mp4");
  const sfxPath   = path.join(workDir, "sfx-bed.m4a");
  const musicPath = path.join(workDir, "music-bed.m4a");
  const videoPath = path.join(workDir, `instagram-rerender-${Date.now()}.mp4`);

  console.log("[Re-render] bg.mp4 kopyalanıyor...");
  await fs.copyFile(EXISTING_BG_MP4, bgDest);

  console.log("[Re-render] Veo3 audio extract ediliyor...");
  await extractVideoAudio(bgDest, musicPath, platform.duration);

  console.log("[Re-render] SFX üretiliyor...");
  await generateSfxBed({ outputPath: sfxPath, duration: platform.duration });

  console.log("[Re-render] FFmpeg render başlıyor...");
  const preResolvedBg = {
    bg1Path: bgDest, bg1IsVideo: true,
    bg2Path: bgDest, bg2IsVideo: true,
    bg3Path: bgDest, bg3IsVideo: true
  };

  await renderVideo({
    imagePath:    null,
    outputPath:   videoPath,
    voicePath:    EXISTING_VOICE_MP3,
    musicPath,
    sfxPath,
    campaign,
    template,
    platform,
    brand,
    workingDir:   workDir,
    kieApiKey:    null,
    keywords:     [],
    preResolvedBg
  });

  console.log("\n✅ Re-render tamamlandı!");
  console.log(`📺 Video: http://localhost:3120/renders/${jobId}/${path.basename(videoPath)}`);
  console.log(`📁 Dosya: ${videoPath}`);
}

main().catch(err => {
  console.error("❌ Hata:", err.message);
  process.exit(1);
});
