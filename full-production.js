"use strict";
/**
 * TAM ÜRETİM — Dinamik süre: ses kaç saniyeyse video o kadar olur
 * Veo3 video döngüye alınır (var olan video yeniden kullanılır, maliyet $0)
 * Kullanım: node full-production.js
 */
require("dotenv").config();
const path       = require("path");
const fs         = require("fs/promises");
const crypto     = require("crypto");
const { execFileSync } = require("child_process");

const { generateVoiceover }                              = require("./voice/voiceover-generator");
const { renderVideo, extractVideoAudio, generateSfxBed } = require("./ffmpeg-video-generator");
const brand   = require("./assets/brand.json");
const template = require("./templates/default-template.json");

// ── Arka plan video — template varsa onu kullan, yoksa eski data-viz ──────────
const TEMPLATE_BG  = "C:/Users/Public/algeonex-render/template/bg-template.mp4";
const FALLBACK_BG  = "C:/Users/Public/algeonex-render/renders/fullprod-a5d1a93d/bg.mp4";
const EXISTING_BG  = require("fs").existsSync(TEMPLATE_BG) ? TEMPLATE_BG : FALLBACK_BG;

const RENDER_BASE = process.env.ALGEONEX_RENDER_DIR || "C:/Users/Public/algeonex-render";
const KIE_API_KEY = process.env.KIE_API_KEY;
const FFMPEG      = require("ffmpeg-static");
const FFPROBE     = FFMPEG.replace("ffmpeg.exe", "ffprobe.exe");

// ── Kampanya metni — uzun, doğal akış ────────────────────────────────────────
const VOICEOVER_TEXT =
  "AI tabanlı büyüme başladı! " +
  "Rakiplerin öneriliyor olabilir. Siz hâlâ sadece arama sonuçlarında mısınız? " +
  "AI çağında görünmek yetmez, önerilmek zorundasınız! " +
  "Yüzde beş ile on beş daha fazla AI trafiği sağlayın ve beş kat daha fazla önerilme şansı yakalayın. " +
  "Hemen ücretsiz AI analizinizi alın ve zirveye tırmanın! Algeonex.com.";

// ── Ses süresini ölç — ffmpeg stderr parse ────────────────────────────────────
function measureDuration(filePath) {
  try {
    // ffmpeg -i file 2>&1 → "Duration: HH:MM:SS.xx" çıktısını parse et
    const { spawnSync } = require("child_process");
    const result = spawnSync(FFMPEG, ["-i", filePath], { encoding: "utf8" });
    const stderr = result.stderr || "";
    const match  = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
    if (!match) return 0;
    return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
  } catch { return 0; }
}

// ── Ses süresine göre sahne zamanlamaları ─────────────────────────────────────
function buildScenes(totalDur) {
  const finale = 1.5;                  // son 1.5s brand finale
  const content = totalDur - finale;   // içerik süresi
  const h  = Math.round(content * 0.18 * 10) / 10;  // %18 hook
  const v  = Math.round(content * 0.47 * 10) / 10;  // %47 value
  // cta = kalan content
  return [
    { id: "scene-1-hook",  start: 0,     end: h,            line1: "AI Tabanlı",             line2: "Büyüme Başladı!" },
    { id: "scene-2-value", start: h,     end: h + v,        line1: "Rakiplerin Öneriliyor",  line2: "Siz Neredesiniz?" },
    { id: "scene-3-cta",   start: h + v, end: content,      line1: "Ücretsiz AI Analizi",    line2: "algeonex.com" }
  ];
}

// ── 8 caption fazı — kelime sayısı + cümle arası duraklama senkronu ──────────
// Ses cümlesi sonunda (!, ?, .) TTS ~0.35s doğal duraklama ekler.
// pause:true → o phrase bittikten sonra PAUSE saniye eklenir → drift giderilir.
// Kelime süresi = (voiceDur - toplam_pause) / toplam_kelime
function buildCaptions(voiceDur) {
  const PAUSE = 0.35;  // TTS cümle sonu duraklaması (saniye)
  const g     = 0.10;  // caption'lar arası geçiş boşluğu

  // pause:true → cümle sonunda TTS duraklar (!, ?, .)
  const phrases = [
    { w:  4, pause: true,  line1: "AI Tabanlı",              line2: "Büyüme Başladı!",            accent: true  },
    { w:  3, pause: false, line1: "Rakiplerin",              line2: "Öneriliyor Olabilir!",        accent: false },
    { w:  6, pause: true,  line1: "Siz Hâlâ Sadece",         line2: "Arama Sonuçlarında mı?",     accent: false },
    { w:  6, pause: true,  line1: "AI Çağında",              line2: "Önerilmek Zorundasınız!",    accent: false },
    { w: 10, pause: false, line1: "%5-15 Daha Fazla",        line2: "AI Trafiği Sağlayın!",       accent: false },
    { w:  8, pause: true,  line1: "5 Kat Daha Fazla",        line2: "Önerilme Şansı Yakalayın!",  accent: false },
    { w:  8, pause: false, line1: "Hemen Ücretsiz",          line2: "AI Analizinizi Alın!",       accent: false },
    { w:  3, pause: true,  line1: "Ücretsiz AI Analizi",     line2: "algeonex.com",               accent: true  },
  ];

  const totalW      = phrases.reduce((s, p) => s + p.w, 0);
  const totalPauses = phrases.filter(p => p.pause).length * PAUSE;
  const wordTime    = voiceDur - totalPauses;   // kelimeler için kalan süre
  const secPerWord  = wordTime / totalW;        // kelime başına düşen süre
  let t = 0;

  return phrases.map(p => {
    const pDur = p.w * secPerWord;
    const cap = {
      start: +Math.max(t, 0).toFixed(2),
      end:   +(t + pDur - g).toFixed(2),
      line1: p.line1,
      line2: p.line2,
      accent: p.accent
    };
    t += pDur + (p.pause ? PAUSE : 0);
    return cap;
  });
}

// ── Veo3'ü döngüye al (ses süresi + 1s) ──────────────────────────────────────
async function loopVideo(inputPath, outputPath, targetDuration) {
  const srcDur = measureDuration(inputPath);
  const loops  = Math.ceil(targetDuration / srcDur) + 1;
  console.log(`   Veo3 süresi: ${srcDur.toFixed(1)}s → ${loops}x döngü → hedef ${targetDuration.toFixed(1)}s`);

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
    ], (err) => {
      if (err) reject(err);
      else resolve(outputPath);
    });
  });
}

// ── Ana üretim ────────────────────────────────────────────────────────────────
async function main() {
  const jobId   = `dynvid-${crypto.randomBytes(4).toString("hex")}`;
  const workDir = path.join(RENDER_BASE, "renders", jobId);
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(path.join(RENDER_BASE, "voice"), { recursive: true });

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  ALGEONEX — DİNAMİK SÜRELİ VIDEO ÜRETİMİ        ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  // 1. Ses üret
  console.log("[1/5] 🎙️  Ses üretiliyor...");
  const voicePath = path.join(RENDER_BASE, "voice", `${jobId}.mp3`);
  await generateVoiceover({ text: VOICEOVER_TEXT, outputPath: voicePath, kieApiKey: KIE_API_KEY });
  const voiceDur  = measureDuration(voicePath);
  const videoDur  = Math.ceil(voiceDur) + 1.5;  // ses + 1.5s brand finale
  console.log(`[1/5] ✅ Ses: ${voiceDur.toFixed(2)}s → Video: ${videoDur.toFixed(1)}s`);

  // 2. Platform dinamik
  const platform = {
    name: "instagram_dynamic",
    width: 1080, height: 1920,
    duration: videoDur,
    fps: 30
  };

  // 3. Sahneleri dinamik oluştur
  const scenes = buildScenes(videoDur);
  console.log(`   Sahneler:`);
  scenes.forEach(s => console.log(`     ${s.id}: ${s.start.toFixed(1)}s → ${s.end.toFixed(1)}s`));

  const captions = buildCaptions(voiceDur);
  console.log(`   Caption fazları (kelime oranı senkronu):`);
  captions.forEach((c, i) => console.log(`     ${i+1}. ${c.start.toFixed(1)}s→${c.end.toFixed(1)}s: "${c.line1}" / "${c.line2}"`));

  const campaign = {
    voiceoverText: VOICEOVER_TEXT,
    hook: "AI Tabanlı Büyüme Başladı!",
    scenes,
    captions,
    textOverlay: scenes.map(s => ({ scene: s.id, start: s.start, end: s.end, text: `${s.line1}\n${s.line2}` })),
    timeline:    scenes.map(s => ({ start: s.start, end: s.end, label: s.id })),
    analysis: { keywords: ["AI", "ALGEONEX", "büyüme", "önerilme"] }
  };

  // 4. Veo3'ü döngüye al
  console.log("\n[2/5] 🎬  Veo3 video döngüye alınıyor...");
  const bgLooped = path.join(workDir, "bg.mp4");
  await loopVideo(EXISTING_BG, bgLooped, videoDur + 0.5);
  console.log("[2/5] ✅ bg.mp4 hazır");

  // 5. Ses çıkar — orijinal Veo3'ten (looped bg.mp4'ün sesi yok)
  console.log("\n[3/5] 🎵  Veo3 ambient ses (orijinalden)...");
  const musicPath = path.join(workDir, "music-bed.m4a");
  await extractVideoAudio(EXISTING_BG, musicPath, videoDur);
  console.log("[3/5] ✅ Music-bed hazır");

  // 6. SFX
  console.log("\n[4/5] 🔊  SFX...");
  const sfxPath = path.join(workDir, "sfx-bed.m4a");
  await generateSfxBed({ outputPath: sfxPath, duration: videoDur });
  console.log("[4/5] ✅ SFX hazır");

  // 7. Render
  console.log("\n[5/5] 🎞️  Render ediliyor...");
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

  const finalStat = await fs.stat(videoPath);

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  ✅ VIDEO TAMAMLANDI!                              ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`\n📺 Video: http://localhost:3120/renders/${jobId}/${path.basename(videoPath)}`);
  console.log(`📁 Dosya: ${videoPath}`);
  console.log(`\n📊 KALİTE ANALİZİ:`);
  console.log(`   Boyut:   ${(finalStat.size/1024/1024).toFixed(1)} MB`);
  console.log(`   Süre:    ${videoDur.toFixed(1)}s (ses: ${voiceDur.toFixed(1)}s + 1.5s finale)`);
  console.log(`   Format:  1080×1920 @ 30fps (Instagram/Facebook/LinkedIn)`);
  console.log(`   Bitiş:   Büyük ALGEONEX + algeonex.com overlay\n`);
}

main().catch(err => {
  console.error("\n❌ Hata:", err.message);
  process.exit(1);
});
