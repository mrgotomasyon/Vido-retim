"use strict";

/**
 * KIE.AI — Nano Banana 2 (Google Gemini 3.1 Flash Image)
 * AI-powered background generation for ALGEONEX video pipeline.
 *
 * Flow:
 *   POST /createTask → taskId
 *   GET  /recordInfo?taskId=... (poll every 3s until state=success)
 *   resultJson.resultUrls[0] → download → local jpg file
 */

const axios = require("axios");
const fs    = require("fs/promises");

const KIE_BASE = "https://api.kie.ai/api/v1/jobs";
const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 30; // 90 seconds max wait

// ---------------------------------------------------------------------------
// Build a content-aware background prompt matching ALGEONEX brand style.
// Reference: dark navy, network grid, glowing particles, blue-purple burst.
// ---------------------------------------------------------------------------

function buildPrompt(keywords = []) {
  const kwStr = keywords.length
    ? ` Technology context: ${keywords.slice(0, 3).join(", ")}.`
    : "";

  return (
    "Create a premium cinematic AI technology advertisement background for ALGEONEX brand. " +
    "Very dark navy background (#0A0F1E) — ultra dark, cinematic, premium feel. " +
    "Top-center: glowing cyan (#00D4FF) light halo / aura radiating upward, like a brand glow — no readable letters, pure light energy. " +
    "AI neural network particle field: glowing neon blue grid lines, flowing digital data streams, network connection nodes with light trails. " +
    "Background depth: subtle purple (#8B5CF6) energy bursts and radial glow in midground. " +
    "Center area: soft open space (darker, clear) where text overlay will be placed. " +
    "Bottom accent: warm orange (#F59E0B) horizon glow gradient fading upward. " +
    "Cinematic, photorealistic, ultra-premium tech advertisement aesthetic. " +
    "NO text, NO readable words, NO logos, NO faces, NO people — pure atmospheric visual only." +
    kwStr
  );
}

// Scene 2: Futuristic HUD / data interface background
function buildSc2Prompt() {
  return (
    "Futuristic AI technology data interface background. " +
    "Very dark navy base (#0A0F1E). " +
    "Glowing neon blue HUD grid lines, holographic data panels with light emission, flowing digital particle streams. " +
    "Network nodes and connection lines forming a dynamic web. " +
    "Subtle cyan (#00D4FF) highlights on grid intersections, purple (#8B5CF6) mid-depth glow. " +
    "Clear empty center zone for text. " +
    "Ultra cinematic, premium tech, abstract. " +
    "NO text, NO readable words, NO logos, NO faces, NO people."
  );
}

// Scene 3: Dark cinematic dramatic background
function buildSc3Prompt() {
  return (
    "Dark dramatic cinematic technology background. " +
    "Deep space aesthetic: very dark navy (#0A0F1E), almost black at edges. " +
    "Glowing purple-blue energy particles drifting softly. " +
    "Soft god-rays / light shafts emanating from center. " +
    "Subtle warm orange (#F59E0B) accent glow at bottom edge. " +
    "Premium startup advertisement atmosphere — powerful, confident, aspirational. " +
    "Moody, elegant, cinematic depth of field effect. " +
    "NO text, NO readable words, NO logos, NO faces, NO people."
  );
}

// ---------------------------------------------------------------------------
// Main function — generate and download background image via kie.ai API.
// Falls back silently (throws) so callers can use programmatic fallback.
// ---------------------------------------------------------------------------

async function generateAIBackground({ prompt, aspectRatio, apiKey, outputPath }) {
  // ── Step 1: Create task ──────────────────────────────────────────────────
  const createResp = await axios.post(
    `${KIE_BASE}/createTask`,
    {
      model: "nano-banana-2",
      input: {
        prompt,
        aspect_ratio: aspectRatio,  // "9:16" | "16:9"
        resolution:   "1K",
        output_format: "jpg"
      }
    },
    {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type":  "application/json"
      },
      timeout: 15000
    }
  );

  if (createResp.data.code !== 200) {
    throw new Error(`KIE createTask failed: ${createResp.data.msg}`);
  }

  const { taskId } = createResp.data.data;

  // ── Step 2: Poll for completion ──────────────────────────────────────────
  let imageUrl = null;
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const pollResp = await axios.get(
      `${KIE_BASE}/recordInfo`,
      {
        params:  { taskId },
        headers: { "Authorization": `Bearer ${apiKey}` },
        timeout: 10000
      }
    );

    const data = pollResp.data.data || {};

    if (data.state === "success") {
      const result = JSON.parse(data.resultJson || "{}");
      imageUrl = (result.resultUrls || [])[0];
      break;
    }

    if (data.state === "fail") {
      throw new Error(`KIE task failed: ${data.failMsg || "unknown error"}`);
    }
    // state === "waiting" → keep polling
  }

  if (!imageUrl) {
    throw new Error(`KIE task timed out after ${(MAX_POLLS * POLL_INTERVAL_MS) / 1000}s`);
  }

  // ── Step 3: Download image ───────────────────────────────────────────────
  const imgResp = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 30000 });
  await fs.writeFile(outputPath, Buffer.from(imgResp.data));

  return outputPath;
}

module.exports = { generateAIBackground, buildPrompt, buildSc2Prompt, buildSc3Prompt };
