"use strict";
/**
 * TTS Script Writer — ham reklam metnini TTS-uyumlu seslendirme senaryosuna çevirir.
 *
 * KIE API gpt-5-4 (/api/v1/responses — senkron) kullanır;
 * mevcut değilse kural-tabanlı normalizer'a döner.
 */

const axios = require("axios");
const { normalizeTurkishTTS } = require("./tts-normalizer");

const KIE_RESPONSES = "https://api.kie.ai/api/v1/responses";

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
 * KIE gpt-5-4 ile TTS senaryosu yaz (/api/v1/responses — senkron yanıt)
 */
async function rewriteWithKieGPT(rawText, apiKey) {
  const resp = await axios.post(
    KIE_RESPONSES,
    {
      model:  "gpt-5-4",
      stream: false,
      input: [
        { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
        { role: "user",   content: [{ type: "input_text", text: rawText }] }
      ]
    },
    {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type":  "application/json"
      },
      timeout: 30000
    }
  );

  const data = resp.data;
  if (data.status !== "completed") {
    throw new Error(`KIE GPT status: ${data.status || JSON.stringify(data).slice(0, 100)}`);
  }

  // output[] → find type:"message" → content[] → find type:"output_text" → text
  const output = (data.output || []).find(o => o.type === "message");
  const text = (output?.content || []).find(c => c.type === "output_text")?.text || "";
  if (!text) throw new Error("KIE GPT: boş yanıt");
  return text.trim();
}

/**
 * Ana fonksiyon: ham metni TTS-uyumlu senaryoya çevir.
 * 1. KIE gpt-5-4 (en iyi kalite — senkron)
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
