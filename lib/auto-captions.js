"use strict";
/**
 * Auto-captions: Rastgele metni cümlelere bölerek caption dizisi üretir.
 * Her cümle kelime sayısına oranla ekranda kalır + cümle sonunda 0.35s pause.
 */

const PAUSE        = 0.35;  // TTS cümle sonu doğal duraklaması
const GAP          = 0.10;  // caption sonu ile sonraki caption başı arası boşluk
const MAX_LINE_LEN = 22;    // tek satır maksimum karakter sayısı

/**
 * Metni cümlelere ayırır: !, ?, . ile biter.
 * "algeonex.com" gibi domain'leri yanlış bölmez.
 */
function splitSentences(text) {
  return text
    .replace(/([!?])\s+/g, "$1\n")
    .replace(/\.\s+(?=[A-ZÇĞİÖŞÜa-zçğışöşü])/g, ".\n")
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Cümleyi 2 satıra böler: ilk yarı → line1, ikinci yarı → line2.
 * Kısa cümleler (≤MAX_LINE_LEN) sadece line1 olur.
 */
function splitLines(sentence) {
  const clean = sentence.replace(/[.!?]$/, "").trim();
  if (clean.length <= MAX_LINE_LEN) return { line1: clean, line2: "" };

  const words = clean.split(" ");
  const mid   = Math.ceil(words.length / 2);
  return {
    line1: words.slice(0, mid).join(" "),
    line2: words.slice(mid).join(" ")
  };
}

/**
 * Ana fonksiyon.
 * @param {string} text     — TTS metninin tamamı
 * @param {number} voiceDur — sesin gerçek süresi (saniye)
 * @returns {{ start, end, line1, line2, accent }[]}
 */
function buildAutoCaptions(text, voiceDur) {
  const sentences = splitSentences(text);
  if (!sentences.length) return [];

  const phrases = sentences.map((s, i) => {
    const words = s.trim().split(/\s+/).length;
    const { line1, line2 } = splitLines(s);
    return {
      w:      words,
      line1,
      line2,
      accent: i === 0 || i === sentences.length - 1
    };
  });

  const totalW      = phrases.reduce((s, p) => s + p.w, 0);
  const totalPauses = phrases.length * PAUSE;
  // En az voiceDur * 0.7 kelime süresi garanti et (aşırı kısa olmasın)
  const wordTime    = Math.max(voiceDur - totalPauses, voiceDur * 0.7);
  const secPerWord  = wordTime / totalW;
  let t = 0;

  return phrases.map(p => {
    const pDur = p.w * secPerWord;
    const cap = {
      start:  +Math.max(t, 0).toFixed(2),
      end:    +(t + pDur - GAP).toFixed(2),
      line1:  p.line1,
      line2:  p.line2,
      accent: p.accent
    };
    t += pDur + PAUSE;
    return cap;
  });
}

module.exports = { buildAutoCaptions };
