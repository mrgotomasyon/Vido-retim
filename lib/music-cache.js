"use strict";
/**
 * music-cache.js — KIE Suno müzik track'ını indir ve önbelleğe al.
 *
 * KIE_MUSIC_TASK_ID env varı varsa, ilk kullanımda o task'ın sesini
 * RENDER_BASE/template/music-bed.mp3 olarak indirir.
 * Sonraki videolarda aynı dosyayı kullanır (tekrar indirmez).
 */

require("dotenv").config();
const path  = require("path");
const fs    = require("fs/promises");
const axios = require("axios");

const RENDER_BASE      = process.env.ALGEONEX_RENDER_DIR || "C:/Users/Public/algeonex-render";
const MUSIC_BED_PATH   = path.join(RENDER_BASE, "template", "music-bed.mp3");
const KIE_BASE         = "https://api.kie.ai/api/v1";

async function ensureMusicBed() {
  // Zaten varsa hemen dön
  try {
    await fs.access(MUSIC_BED_PATH);
    console.log("[MusicCache] Mevcut müzik bed kullanılıyor:", MUSIC_BED_PATH);
    return MUSIC_BED_PATH;
  } catch { /* devam */ }

  const taskId = process.env.KIE_MUSIC_TASK_ID;
  const apiKey = process.env.KIE_API_KEY;

  if (!taskId || !apiKey) {
    throw new Error("KIE_MUSIC_TASK_ID veya KIE_API_KEY eksik");
  }

  console.log("[MusicCache] Suno müzik indiriliyor, taskId:", taskId);

  // Task sonucunu al (zaten tamamlanmış olmalı)
  const pollResp = await axios.get(
    `${KIE_BASE}/generate/record-info`,
    {
      params:  { taskId },
      headers: { "Authorization": `Bearer ${apiKey}` },
      timeout: 15000
    }
  );

  const data = pollResp.data.data || {};
  if (data.status !== "SUCCESS") {
    throw new Error(`Suno task henüz hazır değil: ${data.status}`);
  }

  const sunoData = data.response?.sunoData || [];
  const audioUrl = sunoData[0]?.audioUrl || sunoData[0]?.streamAudioUrl;
  if (!audioUrl) throw new Error("Suno: audioUrl bulunamadı");

  console.log("[MusicCache] Müzik URL:", audioUrl);

  const dlResp = await axios.get(audioUrl, { responseType: "arraybuffer", timeout: 60000 });
  await fs.mkdir(path.dirname(MUSIC_BED_PATH), { recursive: true });
  await fs.writeFile(MUSIC_BED_PATH, Buffer.from(dlResp.data));

  console.log("[MusicCache] ✅ Müzik kaydedildi:", MUSIC_BED_PATH);
  return MUSIC_BED_PATH;
}

async function getMusicBedPath() {
  try {
    return await ensureMusicBed();
  } catch (err) {
    console.warn("[MusicCache] Müzik alınamadı, template ses kullanılacak:", err.message);
    return null;
  }
}

module.exports = { ensureMusicBed, getMusicBedPath };
