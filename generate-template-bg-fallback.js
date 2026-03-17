"use strict";
/**
 * FFmpeg-only fallback background template generator.
 * Used automatically when Veo3/KIE API credits are insufficient.
 * Creates a 10-second animated dark navy/purple gradient that loops seamlessly.
 */
require("dotenv").config();
const path = require("path");
const fs   = require("fs/promises");
const { execFile } = require("child_process");
const FFMPEG = require("ffmpeg-static");

const RENDER_BASE = process.env.ALGEONEX_RENDER_DIR || "/data/renders";

async function main() {
  const outputDir  = path.join(RENDER_BASE, "template");
  const outputPath = path.join(outputDir, "bg-template.mp4");

  await fs.mkdir(outputDir, { recursive: true });

  try {
    await fs.access(outputPath);
    console.log(`[Fallback] ✅ Template zaten mevcut: ${outputPath}`);
    return;
  } catch { /* dosya yok, üret */ }

  console.log("[Fallback] FFmpeg ile arka plan şablonu oluşturuluyor (~10 saniye)...");

  // Dark navy/blue/purple animated gradient using YCbCr oscillation:
  //   Y  ≈ 13-33  (very dark)
  //   Cb ≈ 98-178 (blue variation)
  //   Cr ≈ 93-153 (purple variation)
  await new Promise((resolve, reject) => {
    execFile(FFMPEG, [
      "-y",
      "-f", "lavfi",
      "-i", "color=c=#060d1e:s=1080x1920:r=30",
      "-vf", "geq=lum='13+20*sin(2*PI*T/5+X/300)':cb='138+40*sin(2*PI*T/7+Y/400)':cr='123+30*cos(2*PI*T/6+X/250+Y/350)'",
      "-t", "10",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "23",
      "-an",
      outputPath
    ], (err) => err ? reject(err) : resolve());
  });

  const stat = await fs.stat(outputPath);
  console.log(`[Fallback] ✅ Template hazır: ${outputPath} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch(err => {
  console.error("[Fallback] ❌ Hata:", err.message);
  process.exit(1);
});
