"use strict";
/**
 * TTS Script Writer — ham reklam metnini TTS-uyumlu seslendirme senaryosuna çevirir.
 *
 * Kural seti (örnek videodan çıkarıldı):
 *  - Kısa, vurucu cümleler — her biri ayrı satır
 *  - Sayılar ve yüzdeler yazıyla (yüzde beş, beş kat)
 *  - "AI" olduğu gibi kalır
 *  - Emojiler, oklar, semboller yok
 *  - Doğal duraklamalar (nokta, ünlem, soru işareti)
 *  - 20-25 saniyelik akış hedefi
 *  - Satış odaklı: tehdit + fırsat tonu
 *  - "Algeonex.com." ile biter
 *
 * KIE API GPT-4o kullanır; mevcut değilse kural-tabanlı normalizer'a döner.
 */

const axios = require("axios");
const { normalizeTurkishTTS } = require("./tts-normalizer");

const KIE_BASE = "https://api.kie.ai/api/v1/jobs";

const SYSTEM_PROMPT = `Sen profesyonel bir Türkçe reklam seslendirme metni yazarsın.
Kullanıcının verdiği ham reklam metnini aşağıdaki kurallara göre TTS (text-to-speech) için yeniden yaz:

KURALLAR:
- Metni doğal konuşma diline dönüştür
- Kısa ve vurucu cümleler kullan (her cümle maksimum 10-12 kelime)
- Sayıları ve yüzdeleri MUTLAKA yazıyla yaz: %5 → "yüzde beş", 5 kat → "beş kat"
- "AI" kelimesini OLDUĞU GİBİ bırak (değiştirme)
- Emoji, ok işareti (→), URL dışında sembol KULLANMA
- Doğal duraklamalar için nokta ve ünlem kullan
- Tehdit tonu: rakipler önde, sen geride kalıyorsun
- Fırsat tonu: ALGEONEX ile zirveye çık
- "Algeonex.com." ile bitir
- Sadece seslendirme metnini yaz, açıklama ekleme
- 20-25 saniyelik konuşma akışına uygun yaz
- Toplam metin 80-110 kelime arasında olmalı

ÖRNEK ÇIKTI FORMAT:
AI tabanlı büyüme başladı! Rakiplerin öneriliyor olabilir. Siz hâlâ sadece arama sonuçlarında mısınız? AI çağında görünmek yetmez, önerilmek zorundasınız! Yüzde beş ile on beş daha fazla AI trafiği sağlayın ve beş kat daha fazla önerilme şansı yakalayın. Hemen ücretsiz AI analizinizi alın ve zirveye tırmanın! Algeonex.com.`;

/**
 * KIE GPT-4o ile TTS senaryosu yaz
 */
async function rewriteWithKieGPT(rawText, apiKey) {
  const createResp = await axios.post(
    `${KIE_BASE}/createTask`,
    {
      model: "openai/gpt-4o",
      input: {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user",   content: rawText }
        ],
        temperature: 0.7,
        max_tokens:  300
      }
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
    throw new Error(`KIE GPT create failed: ${createResp.data.msg}`);
  }

  const { taskId } = createResp.data.data;

  // Poll max 30s
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 3000));

    const poll = await axios.get(`${KIE_BASE}/recordInfo`, {
      params:  { taskId },
      headers: { "Authorization": `Bearer ${apiKey}` },
      timeout: 10000
    });

    const d = poll.data.data || {};

    if (d.state === "success") {
      const result = JSON.parse(d.resultJson || "{}");
      // Typical GPT response format
      const text = result.choices?.[0]?.message?.content
                || result.content
                || result.text
                || "";
      if (!text) throw new Error("KIE GPT: boş yanıt");
      return text.trim();
    }

    if (d.state === "fail") {
      throw new Error(`KIE GPT failed: ${d.failMsg || "unknown"}`);
    }
  }

  throw new Error("KIE GPT timed out after 30s");
}

/**
 * Ana fonksiyon: ham metni TTS-uyumlu senaryoya çevir.
 * 1. KIE GPT-4o (en iyi kalite)
 * 2. Rules-based normalizer (fallback)
 */
async function writeScriptForTTS(rawText) {
  const kieKey = process.env.KIE_API_KEY;

  if (kieKey) {
    try {
      const script = await rewriteWithKieGPT(rawText, kieKey);
      console.log("[ScriptWriter] GPT senaryo:", script.slice(0, 100) + "…");
      return script;
    } catch (err) {
      console.warn("[ScriptWriter] GPT başarısız, normalizer'a geçiliyor:", err.message);
    }
  }

  // Fallback: kural-tabanlı temizleme
  const cleaned = normalizeTurkishTTS(rawText);
  console.log("[ScriptWriter] Fallback normalizer kullanıldı");
  return cleaned;
}

module.exports = { writeScriptForTTS };
