"use strict";

/**
 * KIE.AI — Veo3 Fast (Google Veo 3.1)
 * Generates real cinematic VIDEO CLIPS (not static images).
 * 1080x1920 portrait, 8s, 10 Mbps — actual motion animation.
 *
 * Pipeline:
 *   1. POST /veo/generate         → {data: {taskId}}
 *   2. GET  /veo/record-info      → poll until successFlag=1
 *   3. GET  /veo/get-1080p-video  → poll every 25s until code=200
 *   4. Download 1080p MP4
 */

const axios = require("axios");
const fs    = require("fs/promises");

const KIE_BASE = "https://api.kie.ai/api/v1";

// ---------------------------------------------------------------------------
// Generate a Veo3 video clip from a text prompt (TEXT_2_VIDEO)
// Returns: local .mp4 file path at 1080p
// ---------------------------------------------------------------------------
async function generateVeo3Clip({ prompt, aspectRatio, apiKey, outputPath }) {
  // ── Step 1: Create Veo3 task ─────────────────────────────────────────────
  console.log(`[Veo3] Creating task...`);
  const createResp = await axios.post(
    `${KIE_BASE}/veo/generate`,
    {
      model:             "veo3_fast",
      prompt,
      aspectRatio:       aspectRatio || "9:16",
      enableTranslation: false,
      generationType:    "TEXT_2_VIDEO"
    },
    {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type":  "application/json"
      },
      timeout: 20000
    }
  );

  if (createResp.data.code !== 200) {
    throw new Error(`Veo3 createTask failed: ${createResp.data.msg}`);
  }

  const { taskId } = createResp.data.data;
  console.log(`[Veo3] Task: ${taskId}`);

  // ── Step 2: Poll for 720p completion (successFlag=1) ─────────────────────
  let attempts = 0;
  while (attempts < 120) {  // up to 10 minutes
    await new Promise(r => setTimeout(r, 5000));
    attempts++;

    const pollResp = await axios.get(
      `${KIE_BASE}/veo/record-info`,
      {
        params:  { taskId },
        headers: { "Authorization": `Bearer ${apiKey}` },
        timeout: 15000
      }
    );

    const d = pollResp.data.data || {};
    console.log(`[Veo3] Poll ${attempts}: successFlag=${d.successFlag} errorCode=${d.errorCode}`);

    if (d.successFlag === 1) {
      console.log(`[Veo3] 720p ready. Requesting 1080p upgrade...`);
      break;
    }
    if (d.errorCode) {
      throw new Error(`Veo3 failed: ${d.errorMessage || d.errorCode}`);
    }
  }

  // ── Step 3: Poll for 1080p version ───────────────────────────────────────
  let hdUrl = null;
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 25000));  // 25s between attempts

    const hdResp = await axios.get(
      `${KIE_BASE}/veo/get-1080p-video`,
      {
        params:  { taskId, index: 0 },
        headers: { "Authorization": `Bearer ${apiKey}` },
        timeout: 15000
      }
    );

    console.log(`[Veo3] 1080p poll ${i + 1}: code=${hdResp.data.code}`);

    if (hdResp.data.code === 200 && hdResp.data.data?.resultUrl) {
      hdUrl = hdResp.data.data.resultUrl;
      console.log(`[Veo3] 1080p ready: ${hdUrl}`);
      break;
    }
  }

  if (!hdUrl) {
    // Fallback: use 720p URL from record-info
    console.warn("[Veo3] 1080p not available, falling back to 720p");
    const fallbackResp = await axios.get(
      `${KIE_BASE}/veo/record-info`,
      {
        params:  { taskId },
        headers: { "Authorization": `Bearer ${apiKey}` },
        timeout: 15000
      }
    );
    const d = fallbackResp.data.data || {};
    hdUrl = d.response?.resultUrls?.[0];
    if (!hdUrl) throw new Error("Veo3: no video URL available");
  }

  // ── Step 4: Download video ───────────────────────────────────────────────
  console.log(`[Veo3] Downloading...`);
  const dlResp = await axios.get(hdUrl, { responseType: "arraybuffer", timeout: 120000 });
  await fs.writeFile(outputPath, Buffer.from(dlResp.data));
  console.log(`[Veo3] Saved: ${outputPath}`);

  return outputPath;
}

// ---------------------------------------------------------------------------
// Scene-specific Veo3 prompts — ALGEONEX brand aesthetic
// Premium cinematic prompts: camera movement + light source + atmosphere
// ---------------------------------------------------------------------------

function buildSc1VideoPrompt(keywords = []) {
  return (
    "Dark near-black background. Floating holographic data charts, bar graphs and line charts " +
    "made of glowing cyan light slowly rotate in 3D space. " +
    "Streams of blue-white numbers and data particles flow diagonally across the frame. " +
    "Soft blue gradient light source from upper center illuminates the data. " +
    "Cinematic AI data analytics advertisement background, photorealistic, 4K quality. " +
    "No text, no logos, no faces, no people. " +
    "Sound: deep cinematic electronic bass pulse, subtle digital ambient tones, " +
    "data-processing hum, no speech, no vocals, no lyrics, confident tech mood."
  );
}

function buildSc2VideoPrompt() {
  return (
    "Dark navy background. Camera glides over a glowing 3D circuit board landscape. " +
    "Bright cyan and electric blue data pulses travel along circuit pathways like traffic. " +
    "Holographic AI analysis rings and percentage meters float in the air. " +
    "Dynamic light trails and soft lens flare. Open dark center with clear space. " +
    "Cinematic AI analytics technology background, photorealistic, 4K. " +
    "No text, no logos, no faces, no people."
  );
}

function buildSc3VideoPrompt() {
  return (
    "Near-black minimal background. A single powerful glowing cyan energy sphere " +
    "pulses and expands at the center of frame, radiating electric blue light rings outward. " +
    "Particle mist drifts upward. Dramatic god-rays, premium cinematic lens flare. " +
    "Clean dark space in upper and lower thirds. Powerful, confident, premium mood. " +
    "Cinematic premium tech advertisement, photorealistic, 4K. " +
    "No text, no logos, no faces, no people."
  );
}

module.exports = {
  generateVeo3Clip,
  buildSc1VideoPrompt,
  buildSc2VideoPrompt,
  buildSc3VideoPrompt
};
