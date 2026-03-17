"use strict";
/**
 * Container başlangıç scripti.
 * 1. bg-template.mp4 yoksa üretir (tek seferlik, ~5-8 dk)
 * 2. Telegram bot sunucusunu başlatır
 */
require("dotenv").config();
const path = require("path");
const fs   = require("fs/promises");
const { execFileSync } = require("child_process");

const RENDER_BASE = process.env.ALGEONEX_RENDER_DIR || "/data/renders";
const TEMPLATE    = path.join(RENDER_BASE, "template", "bg-template.mp4");

async function ensureTemplate() {
  try {
    await fs.access(TEMPLATE);
    console.log("[Startup] bg-template.mp4 mevcut ✅");
  } catch {
    console.log("[Startup] bg-template.mp4 bulunamadı, üretiliyor...");
    console.log("[Startup] Bu tek seferlik işlem ~5-8 dakika sürer.");
    await fs.mkdir(path.dirname(TEMPLATE), { recursive: true });
    execFileSync("node", [path.join(__dirname, "generate-template-bg.js")], {
      stdio: "inherit",
      env:   { ...process.env, ALGEONEX_RENDER_DIR: RENDER_BASE }
    });
    console.log("[Startup] bg-template.mp4 hazır ✅");
  }
}

async function main() {
  console.log("╔══════════════════════════════════╗");
  console.log("║  ALGEONEX Telegram Bot Başlıyor  ║");
  console.log("╚══════════════════════════════════╝");

  await ensureTemplate();

  console.log("[Startup] Telegram bot başlatılıyor...");
  require("./telegram-bot");
}

main().catch(err => {
  console.error("[Startup] Kritik hata:", err);
  process.exit(1);
});
