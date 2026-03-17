"use strict";

const fs   = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");
const { generateAIBackground, buildPrompt } = require("./kie-background"); // fallback only
const { generateSunoMusic: sunoMusicGen } = require("./kie-music");

// Re-export so server.js can import it
async function generateSunoMusic(opts) { return sunoMusicGen(opts); }
const { generateVeo3Clip, buildSc1VideoPrompt, buildSc2VideoPrompt, buildSc3VideoPrompt } = require("./kie-video");

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

// For filter_complex values (fontfile=, textfile=): colons must be escaped as \:
function escapeFilterPath(inputPath) {
  return inputPath
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/ /g, "\\ ");
}

// For -i input file arguments: only normalize slashes, no colon escaping
function escapeInputPath(inputPath) {
  return inputPath.replace(/\\/g, "/");
}

function toFfmpegColor(color) {
  return color.startsWith("#") ? `0x${color.slice(1)}` : color;
}

async function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "", stdout = "";
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(stderr.trim() || stdout.trim() || `FFmpeg exit ${code}`));
    });
  });
}

function resolveFontPath() {
  const windir = process.env.WINDIR || "C:/Windows";
  const candidates = [
    path.join(windir, "Fonts", "bahnschrift.ttf"),
    path.join(windir, "Fonts", "segoeuib.ttf"),
    path.join(windir, "Fonts", "arialbd.ttf"),
    path.join(windir, "Fonts", "arial.ttf")
  ];
  return candidates.find((p) => {
    try { require("fs").accessSync(p); return true; } catch { return false; }
  });
}

function alphaExpr(start, end, fade) {
  const fi = (start + fade).toFixed(3);
  const fo = Math.max(end - fade, start + 0.01).toFixed(3);
  return (
    `if(lt(t,${fi}),(t-${start.toFixed(3)})/${fade.toFixed(3)},` +
    `if(lt(t,${fo}),1,` +
    `if(lt(t,${end.toFixed(3)}),(${end.toFixed(3)}-t)/${fade.toFixed(3)},0)))`
  );
}

// Upward slide Y animation
function slideY(yBase, start, fadeDur) {
  return `round(${yBase} + 18*max(0,(1-min(max(t-${start.toFixed(3)},0)/${fadeDur.toFixed(3)},1))))`;
}

// ---------------------------------------------------------------------------
// Music bed — modern tech ambient
// ---------------------------------------------------------------------------

async function generateMusicBed({ outputPath, duration }) {
  const fadeOut = Math.max(duration - 1.2, 0.1).toFixed(3);
  const args = [
    "-y",
    "-f","lavfi","-i",`sine=frequency=98:sample_rate=48000:duration=${duration}`,
    "-f","lavfi","-i",`sine=frequency=196:sample_rate=48000:duration=${duration}`,
    "-f","lavfi","-i",`sine=frequency=494:sample_rate=48000:duration=${duration}`,
    "-f","lavfi","-i",`sine=frequency=73:sample_rate=48000:duration=${duration}`,
    "-filter_complex", [
      `[0:a]volume=0.065,lowpass=f=160,aecho=in_gain=0.6:out_gain=0.5:delays=45:decays=0.35[bass]`,
      `[1:a]volume=0.038,tremolo=f=0.7:d=0.50[mid]`,
      `[2:a]volume=0.022,highpass=f=280,afade=t=in:st=0:d=1.8[shimmer]`,
      `[3:a]volume=0.048,lowpass=f=95[sub]`,
      `[bass][mid][shimmer][sub]amix=inputs=4:normalize=0,` +
      `lowpass=f=1600,` +
      `afade=t=in:st=0:d=1.2,` +
      `afade=t=out:st=${fadeOut}:d=1.2[aout]`
    ].join(";"),
    "-map","[aout]","-c:a","aac","-b:a","192k",
    outputPath
  ];
  await runFfmpeg(args);
  return { outputPath, command: [ffmpegPath, ...args].join(" ") };
}

// ---------------------------------------------------------------------------
// SFX bed — scene transition sound effects
// ---------------------------------------------------------------------------

async function generateSfxBed({ outputPath, duration }) {
  // Scene transition SFX: sine tones with envelope simulation via amix + volume
  // SC1→SC2 ping (1100Hz brief), SC2→SC3 thud (440Hz brief), subtle shimmer (880Hz)
  const d = String(duration);
  const args = [
    "-y",
    "-f", "lavfi", "-i", `sine=frequency=1100:sample_rate=48000:duration=${d}`,
    "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${d}`,
    "-f", "lavfi", "-i", `sine=frequency=880:sample_rate=48000:duration=${d}`,
    "-filter_complex", [
      // ping at ~2s: high freq brief pulse — atrim to 0.3s then pad with silence
      `[0:a]atrim=start=0:end=0.3,volume=0.15,apad=whole_dur=${d}[ping]`,
      // thud at ~6s: low freq — delay 6s
      `[1:a]atrim=start=0:end=0.4,volume=0.12,adelay=6000|6000,apad=whole_dur=${d}[thud]`,
      // shimmer at ~6.5s: high freq — delay 6.5s
      `[2:a]atrim=start=0:end=0.25,volume=0.07,adelay=6500|6500,apad=whole_dur=${d}[shimmer]`,
      `[ping][thud][shimmer]amix=inputs=3:normalize=0[out]`
    ].join(";"),
    "-map", "[out]",
    "-c:a", "aac", "-b:a", "128k",
    outputPath
  ];
  await runFfmpeg(args);
  return { outputPath, command: [ffmpegPath, ...args].join(" ") };
}

// ---------------------------------------------------------------------------
// Write text files
// ---------------------------------------------------------------------------

async function writeSceneTexts(scenes, textDir, brand) {
  await fs.mkdir(textDir, { recursive: true });
  const sc1 = scenes[0] || {};
  const sc2 = scenes[1] || {};
  const sc3 = scenes[2] || {};
  const files = {
    sc1L1: path.join(textDir, "sc1-l1.txt"),
    sc1L2: path.join(textDir, "sc1-l2.txt"),
    sc2L1: path.join(textDir, "sc2-l1.txt"),
    sc2L2: path.join(textDir, "sc2-l2.txt"),
    sc3L1: path.join(textDir, "sc3-l1.txt"),
    sc3L2: path.join(textDir, "sc3-l2.txt")
  };
  await Promise.all([
    fs.writeFile(files.sc1L1, sc1.line1 || "AI Aramada",                   "utf8"),
    fs.writeFile(files.sc1L2, sc1.line2 || "Lider Sen Ol",                  "utf8"),
    fs.writeFile(files.sc2L1, sc2.line1 || "%5-15 Daha Fazla AI Trafiği",   "utf8"),
    fs.writeFile(files.sc2L2, sc2.line2 || "5 Kat Daha Fazla Öneril",        "utf8"),
    fs.writeFile(files.sc3L1, sc3.line1 || "Ücretsiz AI Analizi",            "utf8"),
    fs.writeFile(files.sc3L2, sc3.line2 || (brand && brand.url) || "algeonex.com", "utf8")
  ]);
  return files;
}

// ---------------------------------------------------------------------------
// Programmatic fallback background (when no KIE key)
// ---------------------------------------------------------------------------

async function generateProgrammaticBg(outputPath, W, H) {
  await runFfmpeg([
    "-y",
    "-f","lavfi","-i",`color=c=0x060d1e:size=${W}x${H}:rate=1`,
    "-vf",[
      `drawbox=x=0:y=0:w=${W}:h=8:color=0x1E3A8A:t=fill`,
      `drawbox=x=0:y=8:w=${W}:h=3:color=0xF59E0B:t=fill`
    ].join(","),
    "-vframes","1","-q:v","2",
    outputPath
  ]);
  return outputPath;
}

// ---------------------------------------------------------------------------
// Scene background resolution — 3 backgrounds generated in PARALLEL
//
// SC1: User's uploaded image  (if provided) OR AI brand background
// SC2: AI tech data flow interface           (separate AI background)
// SC3: AI dark cinematic particle background (separate AI background)
//
// All 3 KIE API calls run simultaneously via Promise.all (~20s total)
// ---------------------------------------------------------------------------

// resolveSceneBackgrounds — 1 Veo3 clip shared across all 3 scenes
// Cost: $0.025 (1 task). Same background video, different text overlays per scene.
// Fallback: programmatic background if Veo3 fails.
// Returns: { bg1Path, bg2Path, bg3Path, bg1IsVideo, bg2IsVideo, bg3IsVideo }
async function resolveSceneBackgrounds({ imagePath, kieApiKey, keywords, workingDir, W, H }) {
  const aspectRatio = W >= 1400 ? "16:9" : "9:16";
  const mp4Path = path.join(workingDir, "bg.mp4");
  const jpgPath = path.join(workingDir, "bg.jpg");

  let bgPath, bgIsVideo;

  if (imagePath) {
    // User uploaded image — use for SC1, programmatic for SC2/SC3
    bgPath = imagePath;
    bgIsVideo = false;
  } else if (kieApiKey) {
    try {
      console.log(`[Veo3] Generating single background clip...`);
      const prompt = buildSc1VideoPrompt(keywords || []);
      await generateVeo3Clip({ prompt, aspectRatio, apiKey: kieApiKey, outputPath: mp4Path });
      console.log(`[Veo3] Background clip ready ✓`);
      bgPath = mp4Path;
      bgIsVideo = true;
    } catch (err) {
      console.error(`[Veo3] Failed: ${err.message} — using programmatic fallback`);
      await generateProgrammaticBg(jpgPath, W, H);
      bgPath = jpgPath;
      bgIsVideo = false;
    }
  } else {
    await generateProgrammaticBg(jpgPath, W, H);
    bgPath = jpgPath;
    bgIsVideo = false;
  }

  // All 3 scenes share the same background (1 task, $0.025)
  return {
    bg1Path: bgPath, bg1IsVideo: bgIsVideo,
    bg2Path: bgPath, bg2IsVideo: bgIsVideo,
    bg3Path: bgPath, bg3IsVideo: bgIsVideo
  };
}

// ---------------------------------------------------------------------------
// Main render function — 3 scenes × 10 seconds
//
// Scene 1 (0–2s):  User image   · fade in + SLOW ZOOM   · Hook text
// Scene 2 (2–6s):  AI tech bg   · data grid animation   · Value text
// Scene 3 (6–10s): AI dark bg   · soft pull-back zoom   · CTA (orange btn)
//
// Text: subtle white glow halo (two-layer technique)
// ALGEONEX logo: neon cyan, top-center, always visible
// Audio: Voice 100% + Music 22%
// ---------------------------------------------------------------------------

async function renderVideo({
  imagePath,
  outputPath,
  voicePath,
  musicPath,
  sfxPath,
  campaign,
  template,
  platform,
  brand,
  workingDir,
  kieApiKey,
  keywords,
  preResolvedBg   // optional: { bg1Path, bg2Path, bg3Path, bg1IsVideo, bg2IsVideo, bg3IsVideo }
}) {
  const fontPath = resolveFontPath();
  if (!fontPath) throw new Error("Windows fontu bulunamadı.");

  // Use pre-resolved backgrounds if provided, otherwise resolve now
  const { bg1Path, bg2Path, bg3Path, bg1IsVideo, bg2IsVideo, bg3IsVideo } = preResolvedBg || await resolveSceneBackgrounds({
    imagePath,
    kieApiKey,
    keywords: keywords || [],
    workingDir,
    W: platform.width,
    H: platform.height
  });

  const ef = escapeFilterPath;
  const escapedFont = ef(fontPath);

  const W   = platform.width;
  const H   = platform.height;
  const fps = platform.fps;
  const dur = platform.duration;
  const isLS = W >= 1400;

  // ── Dinamik sahne zamanlamaları ─────────────────────────────────────────────
  const scArr = campaign.scenes || [];
  const t1s = scArr[0]?.start ?? 0;
  const t1e = scArr[0]?.end   ?? 2;
  const t2s = scArr[1]?.start ?? 2;
  const t2e = scArr[1]?.end   ?? 6;
  const t3s = scArr[2]?.start ?? 6;
  const t3e = scArr[2]?.end   ?? Math.max(dur - 1.5, t3s + 1);

  const textDir   = path.join(workingDir, "text");
  await writeSceneTexts(campaign.scenes || [], textDir, brand);  // ensures textDir exists

  // ── Captions (campaign.captions veya scenes'ten auto-generate) ─────────────
  const rawCaps = (campaign.captions && campaign.captions.length > 0)
    ? campaign.captions
    : [
      { start: t1s, end: t1e, line1: campaign.scenes?.[0]?.line1 || "", line2: campaign.scenes?.[0]?.line2 || "", accent: true  },
      { start: t2s, end: t2e, line1: campaign.scenes?.[1]?.line1 || "", line2: campaign.scenes?.[1]?.line2 || "", accent: false },
      { start: t3s, end: t3e, line1: campaign.scenes?.[2]?.line1 || "", line2: campaign.scenes?.[2]?.line2 || "", accent: true  },
    ].filter(c => c.line1 || c.line2);

  // Caption font / position constants (tüm caption'lar H*0.72 merkeze hizalı)
  const capFontSz1 = isLS ? 80 : 96;
  const capFontSz2 = isLS ? 64 : 78;
  const capFade    = 0.35;

  // Caption text dosyalarını yaz
  await Promise.all(rawCaps.flatMap((cap, i) => {
    const ops = [];
    if (cap.line1) ops.push(fs.writeFile(path.join(textDir, `cap-${i}-l1.txt`), cap.line1, "utf8"));
    if (cap.line2) ops.push(fs.writeFile(path.join(textDir, `cap-${i}-l2.txt`), cap.line2, "utf8"));
    return ops;
  }));

  // ── Typography ──
  const ty = {
    logo:   isLS ? 62 : 76,   // prominent brand size
    hookL1: isLS ? 82 : 100,  // bigger, bolder hook
    hookL2: isLS ? 74 : 92,
    valL1:  isLS ? 66 : 82,
    valL2:  isLS ? 62 : 76,
    ctaL1:  isLS ? 60 : 78,   // CTA large
    ctaL2:  isLS ? 42 : 52    // URL
  };

  // ── Layout — text below Veo3 orb cluster (72% = dark lower zone) ──
  const textMidY = H * 0.72;
  const lineGap  = 22;
  const pos = {
    logo:   Math.round(H * 0.14),   // koyu gökyüzü bölgesinde, büyük ve görünür
    hookL1: Math.round(textMidY - ty.hookL1 - lineGap / 2),
    hookL2: Math.round(textMidY + lineGap / 2),
    valL1:  Math.round(textMidY - ty.valL1  - lineGap / 2),
    valL2:  Math.round(textMidY + lineGap / 2),
    ctaL1:  Math.round(H * 0.80 - ty.ctaL1 - lineGap / 2),
    ctaL2:  Math.round(H * 0.80 + lineGap / 2)
  };

  // Caption Y positions (tüm caption'lar aynı H*0.72 merkeze hizalı)
  const capY1 = Math.round(textMidY - capFontSz1 - lineGap / 2);
  const capY2 = Math.round(textMidY + lineGap / 2);

  const cx = "(w-text_w)/2";

  // Brand colors
  const cyan   = "0x72f0ff";
  const orange = toFfmpegColor(brand.colors.orange);
  const navy   = "0x060d1e";

  // ── Alpha fade expressions (dinamik) ────────────────────────────────────────
  const a1L1  = alphaExpr(t1s,        t1e,  0.45);
  const a1L2  = alphaExpr(t1s + 0.35, t1e,  0.35);
  const a2L1  = alphaExpr(t2s,        t2e,  0.45);
  const a2L2  = alphaExpr(t2s + 0.40, t2e,  0.35);
  const a3L1  = alphaExpr(t3s,        t3e,  0.50);
  const a3L2  = alphaExpr(t3s + 0.50, t3e,  0.45);
  const aLogo = alphaExpr(0,           dur,  0.50);

  // ── Text backdrops ──
  const mainBgY = Math.round(textMidY - ty.hookL1 - 28);
  const mainBgH = Math.round(ty.hookL1 + ty.hookL2 + lineGap + 56);
  const ctaBgY  = Math.round(pos.ctaL1 - 28);
  const ctaBgH  = Math.round(ty.ctaL1 + ty.ctaL2 + lineGap + 56);

  // ── Scene 2: HUD grid (data animation effect) ──
  const gridLines = [
    Math.round(H * 0.08), Math.round(H * 0.26),
    Math.round(H * 0.48), Math.round(H * 0.72), Math.round(H * 0.88)
  ].map((y, i) =>
    `drawbox=x=0:y=${y}:w=${W}:h=${i % 2 === 0 ? 2 : 1}:color=${i % 2 === 0 ? "0x72f0ff@0.28" : "0x1E3A8A@0.20"}:t=fill`
  ).join(",");

  // ── Scene 1: Ken Burns slow zoom (1.0x → 1.06x) ──
  const sc1Zoom = `zoompan=z='1+0.060*(on/68)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=69:s=${W}x${H}:fps=${fps}`;

  // ── Scene 3: soft reverse zoom (pull-back) ──
  const sc3Zoom = `zoompan=z='1.05-0.05*(on/129)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=130:s=${W}x${H}:fps=${fps}`;

  // ── CTA orange button ──
  const ctaBtnW = isLS ? Math.round(W * 0.58) : Math.round(W * 0.78);
  const ctaBtnH = ty.ctaL1 + 32;
  const ctaBtnX = Math.round((W - ctaBtnW) / 2);
  const ctaBtnY = pos.ctaL1 - 16;

  // ── STROKE TEXT helper ──
  // Professional broadcast technique: NO box, thick black stroke + shadow
  // Readable on ANY background (dark, light, bright, colorful)
  // Used by Netflix, ESPN, YouTube, Instagram pro ads
  const glowText = (input, output, file, size, mainColor, yBase, alpha, enable, start, fadeDur) => {
    const yExpr = slideY(yBase, start, fadeDur);
    const mid = `${input}_m`;
    return [
      // Layer 1: very thick black stroke (creates solid outline on any bg)
      `[${input}]drawtext=fontfile='${escapedFont}':textfile='${file}':reload=1:expansion=none:fix_bounds=1:` +
      `fontsize=${size}:fontcolor=black@0.0:x=${cx}:y='${yExpr}':` +
      `borderw=10:bordercolor=0x000000@0.95:` +
      `alpha='${alpha}':enable='${enable}'[${input}_g]`,
      // Layer 2: medium stroke — adds depth to the outline
      `[${input}_g]drawtext=fontfile='${escapedFont}':textfile='${file}':reload=1:expansion=none:fix_bounds=1:` +
      `fontsize=${size}:fontcolor=black@0.0:x=${cx}:y='${yExpr}':` +
      `borderw=6:bordercolor=0x020810@0.80:` +
      `shadowx=2:shadowy=6:shadowcolor=black@1.0:` +
      `alpha='${alpha}':enable='${enable}'[${mid}]`,
      // Layer 3: crisp colored text on top (white or brand color)
      `[${mid}]drawtext=fontfile='${escapedFont}':textfile='${file}':reload=1:expansion=none:fix_bounds=1:` +
      `fontsize=${size}:fontcolor=${mainColor}:x=${cx}:y='${yExpr}':` +
      `borderw=2:bordercolor=0x000000@0.60:` +
      `shadowx=0:shadowy=3:shadowcolor=black@0.85:` +
      `alpha='${alpha}':enable='${enable}'[${output}]`
    ];
  };

  // ── ALGEONEX logo — büyük, görünür, ince cyan outline + beyaz metin ──
  const logoGlow = (input, output, alpha) => [
    // Pass 1: siyah derin gölge (arka plan fark etmez)
    `[${input}]drawtext=fontfile='${escapedFont}':text='ALGEONEX':` +
    `fontsize=${ty.logo}:fontcolor=black@0.0:x=${cx}:y=${pos.logo}:` +
    `borderw=14:bordercolor=black@0.85:` +
    `shadowx=4:shadowy=4:shadowcolor=black@1.0:alpha='${alpha}'[${input}_lg1]`,
    // Pass 2: beyaz metin + ince cyan outline — temiz marka görünümü
    `[${input}_lg1]drawtext=fontfile='${escapedFont}':text='ALGEONEX':` +
    `fontsize=${ty.logo}:fontcolor=white@1.0:x=${cx}:y=${pos.logo}:` +
    `borderw=2:bordercolor=${cyan}@0.90:` +
    `shadowx=0:shadowy=2:shadowcolor=black@0.80:alpha='${alpha}'[${output}]`
  ];

  // ─────────────────────────────────────────────────────────────────────────
  // FILTER COMPLEX
  //
  // Input 0: bg1 (SC1 — user image or AI brand hero)
  // Input 1: bg2 (SC2 — AI tech data flow interface)
  // Input 2: bg3 (SC3 — AI dark cinematic)
  // Input 3: voice audio
  // Input 4: music audio
  // Input 5: sfx audio
  //
  // Each scene has its own dedicated background image.
  // No split=3 — 3 independent FFmpeg input streams.
  // ─────────────────────────────────────────────────────────────────────────

  // ── Sahne clip süreleri (t1s,t1e.. yukarıda tanımlandı) ────────────────────
  const fadeDurXf = 0.3;
  const d1 = (t1e - t1s) + fadeDurXf;          // sc1 trim süresi
  const d2 = (t2e - t2s) + fadeDurXf;          // sc2 trim süresi
  const d3 = Math.max((t3e - t3s) + fadeDurXf, 1.0);  // sc3 trim süresi
  const xf1 = t1e;                              // xfade1 offset
  const xf2 = t2e;                              // xfade2 offset

  // SC filter chains — zoompan only for static images (video has natural motion)
  const sc1Filters = bg1IsVideo
    ? [`[0:v]trim=duration=${d1.toFixed(3)},setpts=PTS-STARTPTS`,
       `scale=${W}:${H}:force_original_aspect_ratio=increase`,
       `crop=${W}:${H}`, `fps=${fps}`, `format=yuv420p`, `setsar=1`,
       `fade=t=in:st=0:d=0.50[sc1]`].join(",")
    : [`[0:v]trim=duration=${d1.toFixed(3)},setpts=PTS-STARTPTS`,
       `scale=${W}:${H}:force_original_aspect_ratio=increase`,
       `crop=${W}:${H}`, `format=yuv420p`, `setsar=1`,
       sc1Zoom, `fade=t=in:st=0:d=0.50[sc1]`].join(",");

  const sc2Filters = [
    `[1:v]trim=duration=${d2.toFixed(3)},setpts=PTS-STARTPTS`,
    `scale=${W}:${H}:force_original_aspect_ratio=increase`,
    `crop=${W}:${H}`, `fps=${fps}`, `format=yuv420p`, `setsar=1`,
    `drawbox=x=0:y=0:w=${W}:h=${H}:color=0x1E3A8A@0.08:t=fill`,
    gridLines, `fade=t=in:st=0:d=0.30[sc2]`
  ].join(",");

  const sc3Filters = bg3IsVideo
    ? [`[2:v]trim=duration=${d3.toFixed(3)},setpts=PTS-STARTPTS`,
       `scale=${W}:${H}:force_original_aspect_ratio=increase`,
       `crop=${W}:${H}`, `fps=${fps}`, `format=yuv420p`, `setsar=1`,
       `fade=t=in:st=0:d=0.40[sc3]`].join(",")
    : [`[2:v]trim=duration=${d3.toFixed(3)},setpts=PTS-STARTPTS`,
       `scale=${W}:${H}:force_original_aspect_ratio=increase`,
       `crop=${W}:${H}`, `fps=${fps}`, `format=yuv420p`, `setsar=1`,
       sc3Zoom, `fade=t=in:st=0:d=0.40[sc3]`].join(",");

  // ── Caption filtre zinciri ───────────────────────────────────────────────────
  const captionFilters = [];
  {
    let capNode = "vlogo";
    const nCap = rawCaps.length;
    rawCaps.forEach((cap, i) => {
      const isFirst = i === 0;
      const isLast  = i === nCap - 1;
      const accent  = cap.accent !== undefined ? cap.accent : (isFirst || isLast);
      const color1  = accent ? cyan : "white";
      const hasL2   = !!cap.line2;
      const l1Out   = (isLast && !hasL2) ? "vf" : `vc${i}a`;
      const l2Out   = isLast ? "vf" : `vc${i}b`;
      if (cap.line1) {
        const a = alphaExpr(cap.start, cap.end, capFade);
        captionFilters.push(...glowText(capNode, l1Out,
          ef(path.join(textDir, `cap-${i}-l1.txt`)),
          capFontSz1, color1, capY1, a,
          `between(t,${cap.start},${cap.end})`, cap.start, capFade));
        capNode = l1Out;
      }
      if (hasL2) {
        const a2 = alphaExpr(cap.start + 0.25, cap.end, capFade);
        captionFilters.push(...glowText(capNode, l2Out,
          ef(path.join(textDir, `cap-${i}-l2.txt`)),
          capFontSz2, "white", capY2, a2,
          `between(t,${cap.start},${cap.end})`, cap.start + 0.25, capFade));
        capNode = l2Out;
      }
    });
    // Son node vf değilse passthrough ekle
    if (capNode !== "vf") captionFilters.push(`[${capNode}]null[vf]`);
  }

  const filterParts = [

    // ════════════════════════════════════════════════════════════════════════
    // SCENE 1 (0–2.3s): fade in · Ken Burns (image) or natural motion (video)
    // ════════════════════════════════════════════════════════════════════════
    sc1Filters,

    // ════════════════════════════════════════════════════════════════════════
    // SCENE 2 (2–6.3s): AI tech bg · blue overlay + HUD grid · Value text
    // ════════════════════════════════════════════════════════════════════════
    sc2Filters,

    // ════════════════════════════════════════════════════════════════════════
    // SCENE 3 (6–10s): AI dark bg · pull-back (image) or natural motion (video)
    // ════════════════════════════════════════════════════════════════════════
    sc3Filters,

    // ════════════════════════════════════════════════════════════════════════
    // TRANSITIONS — smooth xfade, no hard cuts (dinamik offset)
    // ════════════════════════════════════════════════════════════════════════
    `[sc1][sc2]xfade=transition=fade:duration=${fadeDurXf}:offset=${xf1.toFixed(3)}[sc12]`,
    `[sc12][sc3]xfade=transition=fade:duration=${fadeDurXf}:offset=${xf2.toFixed(3)}[base]`,

    // ════════════════════════════════════════════════════════════════════════
    // ALT ŞERİT — CTA bölgesi (t=6-10) + tüm metin bölgeleri için gradient
    // ════════════════════════════════════════════════════════════════════════
    (() => {
      // Üst metin bölgesi darkener (SC1+SC2)
      const bY  = pos.hookL1 - 70;
      const bH  = ty.hookL1 + ty.hookL2 + lineGap + 140;
      const en  = `between(t,${t1s},${t2e})`;
      // Alt şerit — video altı (CTA dahil tüm süre)
      const stripY = Math.round(H * 0.62);
      const stripH = H - stripY;
      return (
        `[base]` +
        // Üst metin gradyanı
        `drawbox=x=0:y=${bY}:w=${W}:h=${bH}:color=0x000000@0.06:t=fill:enable='${en}',` +
        `drawbox=x=0:y=${bY+24}:w=${W}:h=${bH-48}:color=0x000000@0.12:t=fill:enable='${en}',` +
        `drawbox=x=0:y=${bY+48}:w=${W}:h=${bH-96}:color=0x000000@0.16:t=fill:enable='${en}',` +
        `drawbox=x=0:y=${bY+72}:w=${W}:h=${bH-144}:color=0x000000@0.10:t=fill:enable='${en}',` +
        // Alt koyu şerit — tüm video boyunca
        `drawbox=x=0:y=${stripY}:w=${W}:h=${stripH}:color=0x000000@0.08:t=fill,` +
        `drawbox=x=0:y=${stripY+60}:w=${W}:h=${stripH-60}:color=0x000000@0.14:t=fill,` +
        `drawbox=x=0:y=${stripY+120}:w=${W}:h=${stripH-120}:color=0x000000@0.18:t=fill` +
        `[base_grd]`
      );
    })(),

    // ════════════════════════════════════════════════════════════════════════
    // ENDING — t=9.0: beyaz flash (pulse) → t=9.5–10: siyaha fade-out
    // ════════════════════════════════════════════════════════════════════════
    (() => {
      // Flash: son 1.0–0.6s önce hızlı parlama (0→0.35→0)
      // Fade-out: son 0.5s siyaha geçiş
      const ef0 = (dur - 1.0).toFixed(3);
      const ef1 = (dur - 0.8).toFixed(3);
      const ef2 = (dur - 0.6).toFixed(3);
      const fd0 = (dur - 0.5).toFixed(3);
      return (
        `[base_grd]` +
        `eq=brightness='` +
          `if(between(t,${ef0},${ef1}),(t-${ef0})/0.2*0.35,` +
          `if(between(t,${ef1},${ef2}),(${ef2}-t)/0.2*0.35,` +
          `if(between(t,${fd0},${dur}),-(t-${fd0})/0.5*0.4,0)))` +
        `'[base_flash],` +
        // Siyaha fade: son 0.5 saniye
        `[base_flash]fade=t=out:st=${fd0}:d=0.5[base_end]`
      );
    })(),

    // ════════════════════════════════════════════════════════════════════════
    // LOGO DARK ZONE — logo arkasında koyu overlay (koyu gökyüzü bölgesi)
    // ════════════════════════════════════════════════════════════════════════
    `[base_end]drawbox=x=0:y=${Math.round(H * 0.11)}:w=${W}:h=${Math.round(H * 0.07)}:color=0x000000@0.50:t=fill[base_hdr]`,

    // ════════════════════════════════════════════════════════════════════════
    // ALGEONEX LOGO — büyük, beyaz, profesyonel marka ismi
    // ════════════════════════════════════════════════════════════════════════
    ...logoGlow("base_hdr", "vlogo", aLogo),

    // ════════════════════════════════════════════════════════════════════════
    // TEXT LAYERS — thick stroke, no box, readable on any background
    // SC1 line1 = CYAN (brand), SC1 line2 = white
    // SC2 = white, SC3 = CYAN headline + white URL
    // ════════════════════════════════════════════════════════════════════════

    // TEXT CAPTIONS — dinamik, campaign.captions'tan (7 faz veya scenes auto-generate)
    ...captionFilters,

    // ════════════════════════════════════════════════════════════════════════
    // BRAND FINALE — son 1.5s: koyu overlay + büyük merkez ALGEONEX + URL
    // ════════════════════════════════════════════════════════════════════════
    (() => {
      const fs0 = (dur - 1.5).toFixed(3);   // finale başlangıcı
      const fs1 = (dur - 1.3).toFixed(3);   // metin fade-in başlangıcı
      const fs2 = (dur - 1.0).toFixed(3);   // URL fade-in başlangıcı
      const cy  = Math.round(H / 2);
      const sz1 = isLS ? 130 : 110;
      const sz2 = isLS ? 50  : 44;
      const gap = isLS ? 90  : 75;
      return [
        // Koyu overlay — finale boyunca
        `[vf]drawbox=x=0:y=0:w=${W}:h=${H}:` +
        `color=0x000000@0.80:t=fill:enable='between(t,${fs0},${dur})'[vf_dark]`,
        // Büyük ALGEONEX — alpha ile fade-in
        `[vf_dark]drawtext=fontfile='${escapedFont}':text='ALGEONEX':` +
        `fontsize=${sz1}:fontcolor=white:x=(w-tw)/2:y=(h-th)/2:` +
        `borderw=3:bordercolor=${cyan}:shadowx=0:shadowy=5:shadowcolor=black@1.0:` +
        `alpha='if(gt(t,${fs1}),min((t-${fs1})*4.0,1.0),0)'[vf_brand]`,
        // algeonex.com URL
        `[vf_brand]drawtext=fontfile='${escapedFont}':text='algeonex.com':` +
        `fontsize=${sz2}:fontcolor=${cyan}:x=(w-tw)/2:y=(${cy}+${gap}):` +
        `shadowx=0:shadowy=3:shadowcolor=black@1.0:` +
        `alpha='if(gt(t,${fs2}),min((t-${fs2})*5.0,0.90),0)'[final_v]`
      ];
    })(),

    // ── Audio — Voice 100% + Music 22% (per spec: Voice:100, Music:22) ──
    // NOTE: audio indices are now [3:a] and [4:a] (inputs 0-2 are video)
    `[3:a]volume=1.0,atrim=duration=${dur},asetpts=PTS-STARTPTS[voice]`,
    `[4:a]volume=0.85,afade=t=in:st=0:d=1.0,afade=t=out:st=${Math.max(dur - 1.0, 0.1)}:d=1.0[music]`,
    `[5:a]volume=0.12,atrim=duration=${dur},asetpts=PTS-STARTPTS[sfx]`,
    `[voice][music][sfx]amix=inputs=3:duration=first:normalize=0[aout]`
  ];

  const filterComplex = filterParts.join(";");

  const ei = escapeInputPath;  // short alias for -i file paths (no colon escaping)

  // Build input args per background type:
  // - Image (.jpg): -loop 1 -framerate 30 -t [dur] -i file.jpg  (loop static image)
  // - Video (.mp4): -t [dur] -i file.mp4                        (real video clip)
  function bgInput(filePath, isVideo) {
    if (isVideo) {
      return ["-t", String(dur + 0.5), "-i", ei(filePath)];
    }
    return ["-loop","1", "-framerate", String(fps), "-t", String(dur + 0.5), "-i", ei(filePath)];
  }

  const args = [
    "-y",
    ...bgInput(bg1Path, bg1IsVideo),  // input [0:v]
    ...bgInput(bg2Path, bg2IsVideo),  // input [1:v]
    ...bgInput(bg3Path, bg3IsVideo),  // input [2:v]
    // Audio
    "-i", ei(voicePath),
    "-i", ei(musicPath),
    "-i", ei(sfxPath),
    // Filters
    "-filter_complex", filterComplex,
    "-map","[final_v]",
    "-map","[aout]",
    "-t",String(dur),
    "-r",String(fps),
    "-c:v","libx264",
    "-pix_fmt","yuv420p",
    "-profile:v","high",
    "-preset","slow",        // slow = better quality same file size
    "-crf","18",             // 18 = near-excellent (22 was good, 18 is premium)
    "-tune","film",          // sharp edges, high contrast
    "-movflags","+faststart",
    "-c:a","aac",
    "-b:a","192k",
    outputPath
  ];

  await runFfmpeg(args);
  return { outputPath, command: [ffmpegPath, ...args].join(" ") };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Extract audio track from Veo3 video → use as music bed
// Applies volume reduction + fade in/out to match video duration
// ---------------------------------------------------------------------------
async function extractVideoAudio(videoPath, outputPath, duration) {
  const ffmpegBin = require("ffmpeg-static");
  const { execFile } = require("child_process");

  const fadeOut = Math.max(0, duration - 1.2);
  const args = [
    "-y",
    "-i", videoPath,
    "-vn",                          // no video
    "-t", String(duration + 0.5),   // slightly longer than target
    "-af", `volume=0.28,afade=t=in:st=0:d=1.0,afade=t=out:st=${fadeOut}:d=1.2`,
    "-c:a", "aac",
    "-b:a", "192k",
    outputPath
  ];

  return new Promise((resolve, reject) => {
    execFile(ffmpegBin, args, { windowsHide: true, maxBuffer: 1024 * 1024 * 8 }, (err) => {
      if (err) reject(new Error(`extractVideoAudio failed: ${err.message}`));
      else resolve(outputPath);
    });
  });
}

module.exports = {
  generateMusicBed,
  generateSfxBed,
  generateSunoMusic,
  renderVideo,
  resolveSceneBackgrounds,
  extractVideoAudio
};
