"use strict";
/**
 * TEMPLATE ARKA PLAN ÜRETİCİ
 * Tek seferlik çalıştır → bg-template.mp4 üretilir → sonsuza kadar kullan
 * Her yeni kampanyada sadece ses + caption değişir, bu video aynı kalır
 *
 * Kullanım: node generate-template-bg.js
 */
require("dotenv").config();
const path = require("path");
const fs   = require("fs/promises");
const { generateVeo3Clip } = require("./kie-video");

const KIE_API_KEY = process.env.KIE_API_KEY;
const RENDER_BASE = process.env.ALGEONEX_RENDER_DIR || "C:/Users/Public/algeonex-render";

// ── Template video prompt — loop-friendly, evrensel AI brand background ────────
// Tasarım ilkeleri:
//   1. Başlangıç ve bitiş aynı durumda (loop seamless)
//   2. Kamera hareketi yavaş ve döngüsel (ani kesim yok)
//   3. Renk paleti: siyah/lacivert + neon mavi + mor/violet
//   4. İçerik: data flow, network, grid — hiçbir kampanyaya özgü element yok
const TEMPLATE_PROMPT =
  "Seamless looping dark background for AI technology advertisement. " +
  "Deep black and dark navy (#060d1e) base. " +
  "Continuous flowing streams of glowing blue and violet data lines travel diagonally across frame. " +
  "Hexagonal network grid pulses slowly with electric blue (#72f0ff) and purple (#a855f7) light. " +
  "Particles drift upward in a slow steady stream — motion never stops, never jumps. " +
  "Soft volumetric light rays in deep violet emanate from center-bottom. " +
  "Digital connection nodes blink gently at network intersections. " +
  "The animation flows continuously with no sudden changes — perfect for video loop. " +
  "Dark empty space in upper third and lower third for text overlays. " +
  "Cinematic futuristic AI brand background, photorealistic, 4K. " +
  "No text, no logos, no faces, no people. " +
  "Sound: dark ambient 95 BPM minimal tech beat, deep bass pulse every 4 beats, " +
  "high-frequency shimmer layer, no melody, no vocals, steady professional flow.";

async function main() {
  const outputDir  = path.join(RENDER_BASE, "template");
  const outputPath = path.join(outputDir, "bg-template.mp4");

  await fs.mkdir(outputDir, { recursive: true });

  // Daha önce üretilmişse atla
  try {
    await fs.access(outputPath);
    console.log(`\n✅ Template zaten mevcut: ${outputPath}`);
    console.log(`   Yeniden üretmek için dosyayı silin ve tekrar çalıştırın.\n`);
    return;
  } catch { /* dosya yok, üret */ }

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  ALGEONEX — TEMPLATE ARKA PLAN ÜRETİLİYOR        ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log("Bu tek seferlik bir işlemdir (~5-8 dakika).");
  console.log("Üretilen video sonsuza kadar yeniden kullanılır.\n");

  await generateVeo3Clip({
    prompt:      TEMPLATE_PROMPT,
    aspectRatio: "9:16",
    apiKey:      KIE_API_KEY,
    outputPath
  });

  const stat = await fs.stat(outputPath);
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  ✅ TEMPLATE HAZIR!                                ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`\n📁 Dosya: ${outputPath}`);
  console.log(`📊 Boyut: ${(stat.size / 1024 / 1024).toFixed(1)} MB`);
  console.log(`\n▶  Sonraki adım: full-production.js içinde EXISTING_BG'yi güncelle:`);
  console.log(`   const EXISTING_BG = "${outputPath.replace(/\\/g, "/")}";`);
  console.log(`\n   Artık her yeni kampanya için sadece `);
  console.log(`   VOICEOVER_TEXT değiştir + node full-production.js çalıştır.\n`);
}

main().catch(err => {
  console.error("\n❌ Hata:", err.message);
  process.exit(1);
});
