"use strict";

/**
 * KIE.AI — Suno V4.5 Generate Music
 * Generates cinematic AI music bed for ALGEONEX video ads.
 *
 * Flow (Suno dedicated endpoint — NOT jobs API):
 *   POST /api/v1/generate                        → { data: { taskId } }
 *   GET  /api/v1/generate/record-info?taskId=... → poll until status=SUCCESS
 *   data.response.sunoData[0].audioUrl           → download MP3
 *
 * Cost: $0.06 per generation (12 credits)
 */

const axios = require("axios");
const fs    = require("fs/promises");

const KIE_BASE = "https://api.kie.ai/api/v1";

// ALGEONEX brand music style — dark tech, cinematic, no vocals
const MUSIC_STYLE =
  "cinematic dark tech ambient, electronic, dramatic, corporate advertisement, " +
  "deep bass pulse, subtle synth pads, professional, modern, tense and confident mood, " +
  "no vocals, no lyrics, instrumental only";

const MUSIC_TITLE = "ALGEONEX Ad Background";

// ---------------------------------------------------------------------------
// Generate AI music via KIE Suno V4.5
// Returns: local .mp3 file path
// ---------------------------------------------------------------------------

async function generateSunoMusic({ duration, outputPath, apiKey }) {
  // ── Step 1: Create Suno task ─────────────────────────────────────────────
  console.log("[Suno] Creating music generation task (V4_5)...");

  const createResp = await axios.post(
    `${KIE_BASE}/generate`,
    {
      model:        "V4_5",
      customMode:   true,
      instrumental: true,
      title:        MUSIC_TITLE,
      style:        MUSIC_STYLE,
      prompt:       "cinematic dark tech instrumental background music"
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
    throw new Error(`Suno createTask failed: ${createResp.data.msg}`);
  }

  const { taskId } = createResp.data.data;
  console.log(`[Suno] Task: ${taskId}`);

  // ── Step 2: Poll for completion ──────────────────────────────────────────
  // status values: PENDING → TEXT_SUCCESS → FIRST_SUCCESS → SUCCESS / error states
  let audioUrl = null;
  for (let i = 0; i < 80; i++) {   // up to ~4 minutes (80 × 3s)
    await new Promise((r) => setTimeout(r, 3000));

    const pollResp = await axios.get(
      `${KIE_BASE}/generate/record-info`,
      {
        params:  { taskId },
        headers: { "Authorization": `Bearer ${apiKey}` },
        timeout: 10000
      }
    );

    const data = pollResp.data.data || {};
    console.log(`[Suno] Poll ${i + 1}: status=${data.status}`);

    if (data.status === "SUCCESS") {
      const sunoData = data.response?.sunoData || [];
      audioUrl = sunoData[0]?.audioUrl || sunoData[0]?.streamAudioUrl || null;
      if (!audioUrl) throw new Error("Suno: no audio URL in response");
      console.log(`[Suno] Music ready: ${audioUrl}`);
      break;
    }

    if (data.status && data.status.includes("ERROR")) {
      throw new Error(`Suno failed: ${data.status}`);
    }
  }

  if (!audioUrl) throw new Error("Suno timed out after 4 minutes");

  // ── Step 3: Download audio ───────────────────────────────────────────────
  console.log("[Suno] Downloading music...");
  const dlResp = await axios.get(audioUrl, { responseType: "arraybuffer", timeout: 60000 });
  await fs.writeFile(outputPath, Buffer.from(dlResp.data));
  console.log(`[Suno] Saved: ${outputPath}`);

  return outputPath;
}

module.exports = { generateSunoMusic };
