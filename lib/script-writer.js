"use strict";
/**
 * TTS Script Writer — ham reklam metnini TTS-uyumlu seslendirme senaryosuna çevirir.
 *
 * OpenAI GPT-4o (/v1/chat/completions — senkron) kullanır;
 * mevcut değilse kural-tabanlı normalizer'a döner.
 */

const axios = require("axios");
const { normalizeTurkishTTS } = require("./tts-normalizer");

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

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
 * OpenAI GPT-4o ile TTS senaryosu yaz (senkron)
 */
async function rewriteWithOpenAI(rawText, apiKey) {
  const resp = await axios.post(
    OPENAI_URL,
    {
      model:       "gpt-4o",
      messages:    [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: rawText }
      ],
      max_tokens:  400,
      temperature: 0.7
    },
    {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type":  "application/json"
      },
      timeout: 30000
    }
  );

  const text = resp.data.choices?.[0]?.message?.content || "";
  if (!text) throw new Error(`OpenAI: boş yanıt (${JSON.stringify(resp.data).slice(0, 100)})`);
  return text.trim();
}

/**
 * Ana fonksiyon: ham metni TTS-uyumlu senaryoya çevir.
 * 1. OpenAI GPT-4o (en iyi kalite — senkron)
 * 2. Rules-based normalizer (fallback)
 */
async function writeScriptForTTS(rawText) {
  const openaiKey = process.env.OPENAI_API_KEY;

  if (openaiKey) {
    try {
      const script = await rewriteWithOpenAI(rawText, openaiKey);
      console.log("[ScriptWriter] OpenAI senaryo:", script.slice(0, 100) + "…");
      return script;
    } catch (err) {
      console.warn("[ScriptWriter] OpenAI başarısız, normalizer'a geçiliyor:", err.message);
    }
  }

  // Fallback: kural-tabanlı temizleme
  const cleaned = normalizeTurkishTTS(rawText);
  console.log("[ScriptWriter] Fallback normalizer kullanıldı");
  return cleaned;
}

module.exports = { writeScriptForTTS };
