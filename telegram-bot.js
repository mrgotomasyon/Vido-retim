"use strict";
require("dotenv").config();

const TelegramBot          = require("node-telegram-bot-api");
const express              = require("express");
const path                 = require("path");
const fs                   = require("fs/promises");
const { produceVideo }     = require("./lib/produce-video");

const TOKEN       = process.env.TELEGRAM_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;   // ör: https://video.example.com
const PORT        = parseInt(process.env.PORT || "3000", 10);
const RENDER_BASE = process.env.ALGEONEX_RENDER_DIR || "C:/Users/Public/algeonex-render";

const axios = require("axios");
const TEMPLATE_BG    = require("path").join(RENDER_BASE, "template", "bg-template.mp4");
const KIE_BG_VIDEO_URL = process.env.KIE_BG_VIDEO_URL; // KIE video URL → bg-template olarak indir

async function ensureBgTemplate() {
  const fss = require("fs/promises");
  await fss.mkdir(require("path").dirname(TEMPLATE_BG), { recursive: true });
  try { await fss.access(TEMPLATE_BG); return; } catch { /* indir */ }
  if (!KIE_BG_VIDEO_URL) return;
  console.log("[Setup] bg-template.mp4 indiriliyor:", KIE_BG_VIDEO_URL);
  try {
    const resp = await axios.get(KIE_BG_VIDEO_URL, { responseType: "arraybuffer", timeout: 120000 });
    await fss.writeFile(TEMPLATE_BG, Buffer.from(resp.data));
    console.log("[Setup] ✅ bg-template.mp4 hazır");
  } catch (err) {
    console.warn("[Setup] bg-template indirilemedi:", err.message);
  }
}

if (!TOKEN) {
  console.error("❌ TELEGRAM_TOKEN env var eksik!");
  process.exit(1);
}

// ── Bot başlat ────────────────────────────────────────────────────────────────
const bot = new TelegramBot(TOKEN, {
  polling: !WEBHOOK_URL  // dev: polling, prod: webhook
});

if (!WEBHOOK_URL) {
  console.log("[Bot] Polling modu aktif (geliştirme)");
}

// ── Ana menü klavyesi ─────────────────────────────────────────────────────────
const MAIN_MENU = {
  reply_markup: {
    keyboard: [
      [{ text: "🎬 Video Üret" }],
      [{ text: "📊 Sistem Durumu" }, { text: "ℹ️ Yardım" }]
    ],
    resize_keyboard: true,
    persistent: true
  }
};

// Kullanıcıdan metin beklendiğinde gösterilen klavye
const CANCEL_MENU = {
  reply_markup: {
    keyboard: [[{ text: "❌ İptal" }]],
    resize_keyboard: true,
    one_time_keyboard: true
  }
};

// Kullanıcıların metin girişi bekleme durumu
const awaitingText = new Set();

// ── Mesaj işleyici ────────────────────────────────────────────────────────────
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text   = (msg.text || "").trim();

  // ── /start, /help veya menü butonu ────────────────────────────────────────
  if (!text || text === "/start" || text === "ℹ️ Yardım" || text === "/help") {
    awaitingText.delete(chatId);
    return bot.sendMessage(chatId,
      "🎬 *ALGEONEX Video Üretici*\n\n" +
      "Reklam metnini yaz, 1080p dikey video \\(ses \\+ görsel\\) otomatik hazır\\.\\.\\.\\.\n\n" +
      "👇 Menüden başla:",
      { parse_mode: "MarkdownV2", ...MAIN_MENU }
    );
  }

  // ── Sistem durumu ──────────────────────────────────────────────────────────
  if (text === "📊 Sistem Durumu" || text === "/status") {
    const durumu = global.templateReady
      ? "✅ Video üretmeye hazır"
      : "⏳ İlk kurulum devam ediyor \\(\\~5\\-8 dk\\)";
    return bot.sendMessage(chatId,
      `*Sistem Durumu*\n\n${durumu}`,
      { parse_mode: "MarkdownV2", ...MAIN_MENU }
    );
  }

  // ── Video üret butonu ──────────────────────────────────────────────────────
  if (text === "🎬 Video Üret" || text === "/video") {
    awaitingText.add(chatId);
    return bot.sendMessage(chatId,
      "✍️ *Reklam metnini yaz:*",
      { parse_mode: "MarkdownV2", ...CANCEL_MENU }
    );
  }

  // ── İptal ──────────────────────────────────────────────────────────────────
  if (text === "❌ İptal") {
    awaitingText.delete(chatId);
    return bot.sendMessage(chatId, "↩️ İptal edildi\\.", { parse_mode: "MarkdownV2", ...MAIN_MENU });
  }

  if (text.startsWith("/")) return; // diğer komutları yoksay

  // Menüden "Video Üret" seçilmeden doğrudan metin gönderilmişse yönlendir
  if (!awaitingText.has(chatId)) {
    return bot.sendMessage(chatId,
      "👇 Önce *🎬 Video Üret* butonuna bas\\.",
      { parse_mode: "MarkdownV2", ...MAIN_MENU }
    );
  }

  awaitingText.delete(chatId);

  if (text.length < 10) {
    return bot.sendMessage(chatId, "⚠️ Metin çok kısa\\. Biraz daha uzun yaz\\.", { parse_mode: "MarkdownV2", ...MAIN_MENU });
  }

  // Arka plan template üretimi devam ediyorsa beklet
  if (global.templateReady === false) {
    return bot.sendMessage(chatId,
      "⏳ Sistem hazırlanıyor \\(ilk açılış\\)\\.\n\nBirkaç dakika sonra tekrar dene\\.",
      { parse_mode: "MarkdownV2", ...MAIN_MENU }
    );
  }

  // ── Üretim başlasın ───────────────────────────────────────────────────────
  const waitMsg = await bot.sendMessage(chatId,
    "⏳ *Video hazırlanıyor\\.\\.\\.* \\(2\\-3 dk\\)",
    { parse_mode: "MarkdownV2" }
  );

  // Her 4 saniyede "upload_video" aksiyonu gönder (bot aktif görünsün)
  const typing = setInterval(() => {
    bot.sendChatAction(chatId, "upload_video").catch(() => {});
  }, 4000);

  try {
    const videoPath = await produceVideo({ text });
    clearInterval(typing);

    const stat    = await fs.stat(videoPath);
    const mb      = (stat.size / 1024 / 1024).toFixed(1);
    // Build public URL: static route serves RENDER_BASE/renders/ at /renders/
    // videoPath = RENDER_BASE/renders/jobId/file.mp4 → relPath = jobId/file.mp4
    const renderBase = path.join(RENDER_BASE, "renders").replace(/\\/g, "/");
    const relPath = videoPath.replace(/\\/g, "/").replace(renderBase + "/", "");
    const videoUrl = WEBHOOK_URL ? `${WEBHOOK_URL}/renders/${relPath}` : null;
    if (videoUrl) console.log(`[Bot] Video URL: ${videoUrl}`);

    // Bekleme mesajını sil
    await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});

    const urlLine = videoUrl ? `\n🔗 ${escapeMarkdown(videoUrl)}` : "";
    await bot.sendVideo(chatId, videoPath, {
      caption:            `✅ *Video hazır\\!* \\(${escapeMarkdown(mb)} MB \\| 1080×1920 30fps\\)${urlLine}`,
      parse_mode:         "MarkdownV2",
      supports_streaming: true,
      ...MAIN_MENU
    });

  } catch (err) {
    clearInterval(typing);
    console.error("[Bot] Üretim hatası:", err);

    await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
    await bot.sendMessage(chatId,
      `❌ *Video üretilemedi\\.* Tekrar dene\\.\n\n_Hata: ${escapeMarkdown(err.message.slice(0, 200))}_`,
      { parse_mode: "MarkdownV2", ...MAIN_MENU }
    );
  }
});

bot.on("polling_error", (err) => {
  console.error("[Bot] Polling hatası:", err.message);
});

// ── MarkdownV2 escape ─────────────────────────────────────────────────────────
function escapeMarkdown(text) {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

// ── Express + Webhook ─────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "1mb" }));

const WEBHOOK_PATH = `/webhook/${TOKEN}`;

app.post(WEBHOOK_PATH, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString(), mode: WEBHOOK_URL ? "webhook" : "polling" });
});

// Render dosyalarına HTTP erişim
// RENDER_BASE/renders/jobId/file.mp4 → /renders/jobId/file.mp4
app.use("/renders", express.static(path.join(RENDER_BASE, "renders")));

app.listen(PORT, async () => {
  console.log(`[Bot] Sunucu port ${PORT}'de başladı`);

  // Arka plan videosu + müzik önbelleği
  await ensureBgTemplate();
  const { ensureMusicBed } = require("./lib/music-cache");
  ensureMusicBed().catch(err => console.warn("[Setup] Müzik önbellek:", err.message));

  if (WEBHOOK_URL) {
    const fullUrl = `${WEBHOOK_URL}${WEBHOOK_PATH}`;
    try {
      await bot.setWebHook(fullUrl);
      console.log(`[Bot] Webhook kuruldu: ${fullUrl}`);
    } catch (err) {
      console.error("[Bot] Webhook kurulamadı:", err.message);
    }
  }
});
