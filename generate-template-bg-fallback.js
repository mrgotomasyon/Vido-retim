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
const _ffmpegStatic = require("ffmpeg-static");
const FFMPEG = require("fs").existsSync("/usr/bin/ffmpeg") ? "/usr/bin/ffmpeg" : _ffmpegStatic;

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

  // Dark navy/purple background with subtle film-grain animation.
  // Uses format=yuv420p to ensure correct color space (geq had RGB/YUV mismatch).
  // noise=alls=6:allf=t adds per-frame temporal grain → looks animated without color issues.
  await new Promise((resolve, reject) => {
    execFile(FFMPEG, [
      "-y",
      "-f", "lavfi", "-i", "color=c=#060d1e:s=1080x1920:r=30",
      "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-vf", "format=yuv420p,noise=alls=6:allf=t",
      "-t", "10",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k",
      "-shortest",
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
