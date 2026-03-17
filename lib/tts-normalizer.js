"use strict";
/**
 * Turkish TTS Text Normalizer
 * Converts raw marketing text to clean, TTS-friendly Turkish.
 *
 * Rules:
 *  - Strip all emojis / symbol codepoints
 *  - %5-15  → yüzde beş ile on beş
 *  - %15    → yüzde on beş
 *  - 5 kat  → beş kat
 *  - algeonex.com → algeonex nokta com
 *  - em-dash — → pause comma
 *  - arrows → removed
 */

const TENS = ['', '', 'yirmi', 'otuz', 'kırk', 'elli', 'altmış', 'yetmiş', 'seksen', 'doksan'];
const ONES = [
  'sıfır', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz',
  'on', 'on bir', 'on iki', 'on üç', 'on dört', 'on beş',
  'on altı', 'on yedi', 'on sekiz', 'on dokuz'
];

function numToTR(n) {
  n = parseInt(n, 10);
  if (isNaN(n) || n < 0) return String(n);
  if (n < 20)  return ONES[n];
  if (n < 100) {
    const t = Math.floor(n / 10), o = n % 10;
    return o === 0 ? TENS[t] : `${TENS[t]} ${ONES[o]}`;
  }
  if (n === 100) return 'yüz';
  if (n < 1000) {
    const h = Math.floor(n / 100), rest = n % 100;
    const hStr = h === 1 ? 'yüz' : `${ONES[h]} yüz`;
    return rest === 0 ? hStr : `${hStr} ${numToTR(rest)}`;
  }
  return String(n);
}

function normalizeTurkishTTS(text) {
  return text
    // ── Emoji / symbol codepoint ranges ────────────────────────────────────
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, ' ')   // Misc symbols, emoticons
    .replace(/[\u{2600}-\u{27BF}]/gu,   ' ')   // Misc symbols (☀✨🎉)
    .replace(/[\u{2B00}-\u{2BFF}]/gu,   ' ')   // Misc symbols (⭐⬆)
    .replace(/[\u{FE00}-\u{FEFF}]/gu,   '')    // Variation selectors

    // ── Numbers ─────────────────────────────────────────────────────────────
    // %5-15 → yüzde beş ile on beş
    .replace(/%\s*(\d+)\s*[-–]\s*(\d+)/g, (_, a, b) => `yüzde ${numToTR(a)} ile ${numToTR(b)}`)
    // %15 → yüzde on beş
    .replace(/%\s*(\d+)/g, (_, n) => `yüzde ${numToTR(n)}`)
    // 5 kat → beş kat
    .replace(/\b(\d+)\s+kat\b/g, (_, n) => `${numToTR(n)} kat`)
    // standalone numbers
    .replace(/\b(\d+)\b/g, (_, n) => numToTR(parseInt(n, 10)))

    // ── Domains — keep as-is, ElevenLabs TR reads .com naturally ──────────────
    // .replace(/\b(\w+)\.com\b/gi, (_, d) => `${d} nokta com`)

    // ── Punctuation / special chars ──────────────────────────────────────────
    .replace(/\s*[—–]\s*/g, ', ')                 // em/en dash → comma pause
    .replace(/[→←►▶➡➤↑↓✓•·]/g, ' ')             // arrows & bullets
    .replace(/["""''«»]/g, ' ')                   // quotes
    .replace(/!+/g,  '!')                         // multi exclamation
    .replace(/\?+/g, '?')                         // multi question

    // ── Whitespace cleanup ───────────────────────────────────────────────────
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { normalizeTurkishTTS, numToTR };
