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
- Metni akıcı, doğal konuşma diline dönüştür
- Her cümle maksimum 10-12 kelime — kısa ve net
- Sayıları ve yüzdeleri yazıyla yaz: %15 → "yüzde on beş", 3 kat → "üç kat"
- "AI" kelimesini olduğu gibi bırak — değiştirme, ekleme yapma
- Emoji, ok işareti (→), URL dışında HİÇBİR sembol kullanma
- Nokta ve virgülle doğal durak ver; ünlem işaretini yalnızca güçlü vurgu anlarında kullan
- TTS'in düzgün okuması için: karmaşık hece birleşimlerinden kaçın, kısa heceli kelimeler tercih et
- Kullanıcının metnindeki ana fikirlerin TAMAMINI aktar — hiçbirini atlama
- Ton: ilk cümle dikkat çekici hook, orta kısım değer/fırsat, son cümle CTA
- "Algeonex.com." ile bitir
- Sadece seslendirme metnini yaz, başka açıklama ekleme
- 20-25 saniyelik konuşma için 80-110 kelime

ÖRNEK ÇIKTI:
AI çağı başladı. Rakipleriniz yapay zeka sistemlerine önerilirken siz hâlâ geri planda mısınız? Görünmek artık yeterli değil, önerilmek zorundasınız. Yüzde on beşe kadar daha fazla AI trafiği ve üç kat daha yüksek önerilme şansı sizi bekliyor. Ücretsiz AI analizinizi hemen alın. Algeonex.com.`;

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
