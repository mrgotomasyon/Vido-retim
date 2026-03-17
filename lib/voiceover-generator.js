const { execFile } = require("child_process");
const path = require("path");
const fs   = require("fs/promises");
const axios = require("axios");

const KIE_BASE = "https://api.kie.ai/api/v1/jobs";

// ---------------------------------------------------------------------------
// KIE.AI — ElevenLabs Turbo 2.5 (PRIMARY — no permission issues)
// Same key as nano-banana-2 image model.
// Best Turkish voice: "George" with language_code="tr" → natural TR pronunciation
// ---------------------------------------------------------------------------

async function generateWithKieTTS({ text, outputPath, apiKey }) {
  const createResp = await axios.post(
    `${KIE_BASE}/createTask`,
    {
      model: "elevenlabs/text-to-speech-turbo-2-5",
      input: {
        text,
        voice:            process.env.KIE_VOICE_ID || "tnSpp4vdxKPjI9w0GnoV",
        stability:        0.45,
        similarity_boost: 0.80,
        style:            0.70,
        speed:            1.05,
        language_code:    "tr"
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
    throw new Error(`KIE TTS create failed: ${createResp.data.msg}`);
  }

  const { taskId } = createResp.data.data;

  // Poll every 3s, max 60s
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 3000));

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
      const result   = JSON.parse(data.resultJson || "{}");
      const audioUrl = (result.resultUrls || [])[0];
      if (!audioUrl) throw new Error("KIE TTS: no audio URL in result");

      const dlResp = await axios.get(audioUrl, { responseType: "arraybuffer", timeout: 30000 });
      await fs.writeFile(outputPath, Buffer.from(dlResp.data));

      return {
        selectedVoice: "Custom TR Voice (KIE ElevenLabs Turbo 2.5)",
        culture: "tr-TR",
        output: outputPath,
        provider: "kie-elevenlabs",
        format: "mp3"
      };
    }

    if (data.state === "fail") {
      throw new Error(`KIE TTS failed: ${data.failMsg || "unknown"}`);
    }
  }

  throw new Error("KIE TTS timed out after 60s");
}

// ---------------------------------------------------------------------------
// ElevenLabs direct API (SECONDARY fallback)
// ---------------------------------------------------------------------------

const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "pMsXgVXv3BLzUgSXRplE";

async function generateWithElevenLabs(text, outputPath) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY bulunamadı.");

  const response = await axios({
    method: "POST",
    url: `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}?output_format=mp3_44100_128`,
    headers: {
      "Accept":         "audio/mpeg",
      "xi-api-key":     apiKey,
      "Content-Type":   "application/json"
    },
    data: {
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability:        0.35,
        similarity_boost: 0.85,
        style:            0.20,
        use_speaker_boost: true,
        speed:            0.95
      }
    },
    responseType: "arraybuffer"
  });

  await fs.writeFile(outputPath, Buffer.from(response.data));

  return {
    selectedVoice: ELEVENLABS_VOICE_ID,
    culture: "tr-TR",
    output: outputPath,
    provider: "elevenlabs",
    format: "mp3"
  };
}

// ---------------------------------------------------------------------------
// Windows SAPI PowerShell fallback (LAST RESORT)
// ---------------------------------------------------------------------------

function generateWithSapi({ text, outputPath, culture, rate }) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, "generate-voiceover.ps1");
    const args = [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", scriptPath,
      "-Text", text,
      "-OutputPath", outputPath,
      "-Culture", culture || "tr-TR",
      "-Rate", String(rate !== undefined ? rate : -2)
    ];

    execFile(
      "powershell.exe",
      args,
      { windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || stdout?.trim() || "Voiceover oluşturulamadı."));
          return;
        }

        try {
          const res = JSON.parse(stdout.trim());
          res.provider = "sapi";
          res.format   = "wav";
          resolve(res);
        } catch {
          resolve({
            selectedVoice: "unknown",
            culture: culture || "tr-TR",
            output: outputPath,
            provider: "sapi",
            format: "wav",
            raw: stdout.trim()
          });
        }
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Main entry point — priority: KIE TTS → ElevenLabs → SAPI
// ---------------------------------------------------------------------------

async function generateVoiceover({ text, outputPath, culture = "tr-TR", rate = -2 }) {
  const kieKey      = process.env.KIE_API_KEY;
  const elevenKey   = process.env.ELEVENLABS_API_KEY;

  // 1. KIE ElevenLabs Turbo 2.5 — best quality, same key as image gen
  if (kieKey) {
    try {
      return await generateWithKieTTS({ text, outputPath, apiKey: kieKey });
    } catch (err) {
      console.warn("[Voiceover] KIE TTS başarısız, bir sonraki deneniyor:", err.message);
    }
  }

  // 2. ElevenLabs direct API
  if (elevenKey) {
    try {
      return await generateWithElevenLabs(text, outputPath);
    } catch (err) {
      console.warn("[Voiceover] ElevenLabs direkt başarısız, SAPI fallback:", err.message);
    }
  }

  // 3. SAPI fallback (Windows TTS)
  return generateWithSapi({ text, outputPath, culture, rate });
}

module.exports = { generateVoiceover };
