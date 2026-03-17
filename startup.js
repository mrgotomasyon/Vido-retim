"use strict";
/**
 * Container başlangıç scripti.
 * 1. Telegram bot sunucusunu hemen başlatır (health check geçsin)
 * 2. bg-template.mp4 yoksa arka planda üretir (tek seferlik, ~5-8 dk)
 */
require("dotenv").config();
const path = require("path");
const fs   = require("fs/promises");
const { execFile } = require("child_process");

const RENDER_BASE = process.env.ALGEONEX_RENDER_DIR || "/data/renders";
const TEMPLATE    = path.join(RENDER_BASE, "template", "bg-template.mp4");

// Global flag: template hazır mı?
global.templateReady = false;

async function generateTemplateBackground() {
  try {
    await fs.access(TEMPLATE);
    console.log("[Startup] bg-template.mp4 mevcut ✅");
    global.templateReady = true;
  } catch {
    console.log("[Startup] bg-template.mp4 bulunamadı, arka planda üretiliyor...");
    console.log("[Startup] Bu tek seferlik işlem ~5-8 dakika sürer.");
    await fs.mkdir(path.dirname(TEMPLATE), { recursive: true });
    execFile("node", [path.join(__dirname, "generate-template-bg.js")], {
      env: { ...process.env, ALGEONEX_RENDER_DIR: RENDER_BASE }
    }, (err) => {
      if (err) {
        console.error("[Startup] bg-template.mp4 üretim hatası:", err.message);
      } else {
        console.log("[Startup] bg-template.mp4 hazır ✅");
        global.templateReady = true;
      }
    });
  }
}

async function main() {
  console.log("╔══════════════════════════════════╗");
  console.log("║  ALGEONEX Telegram Bot Başlıyor  ║");
  console.log("╚══════════════════════════════════╝");

  // Önce sunucuyu başlat (health check hemen geçsin)
  console.log("[Startup] Telegram bot başlatılıyor...");
  require("./telegram-bot");

  // Sonra template'i arka planda üret
  generateTemplateBackground();
}

main().catch(err => {
  console.error("[Startup] Kritik hata:", err);
  process.exit(1);
});
