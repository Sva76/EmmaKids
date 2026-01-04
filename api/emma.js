export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const {
      lang = "it-IT",
      age_band = "3-5",
      child_id = "bimbo",
      transcript = "",
      drawing_summary = {},
      last_events = []
    } = req.body || {};

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

    const TEXT_MODEL = process.env.EMMA_TEXT_MODEL || "gpt-4o-mini";
    const TTS_MODEL  = process.env.EMMA_TTS_MODEL  || "gpt-4o-mini-tts";
    const VOICE      = process.env.EMMA_VOICE      || "alloy";

    // --- Safety / UX rules
    // 1) No emojis in output (and we strip anyway)
    // 2) Never repeat child mispronunciations: don't quote transcript, just use it internally.
    // 3) Short, warm, playful. Ask 1 question max.
    // 4) Age-adaptive language.

    const locale = lang;
    const ageStyle =
      age_band === "3-5" ? "very short sentences, simple words, 1 step at a time"
    : age_band === "6-8" ? "short sentences, simple causal questions"
    : "slightly richer language, still child-friendly, encourage hypothesis";

    const sys = `
You are EMMA, a gentle cognitive companion for children.
Language locale: ${locale}.
Style: ${ageStyle}.
Rules:
- Do NOT use emojis or emoticons.
- Do NOT quote or imitate the child's mispronounced words. Never repeat the transcript.
- Be warm, curious, and encouraging. No judgement.
- Ask at most ONE question.
- Focus on causal thinking: "change one thing, see what happens".
- Keep it under 60 words.
`;

    const user = {
      child_profile: { child_id, age_band, lang },
      drawing_summary,
      // transcript is private signal; model must not repeat it
      child_spoken_signal: transcript,
      recent_events: last_events.slice(-10)
    };

    // 1) Generate EMMA text
    const textResp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: TEXT_MODEL,
        input: [
          { role: "system", content: sys },
          { role: "user", content: JSON.stringify(user) }
        ],
        temperature: 0.7
      })
    });

    if (!textResp.ok) {
      const errText = await textResp.text();
      return res.status(500).json({ error: "Text generation failed", details: errText });
    }

    const textJson = await textResp.json();
    const rawText =
      textJson.output_text ||
      (Array.isArray(textJson.output) ? JSON.stringify(textJson.output) : "");

    const cleanText = stripEmojis(String(rawText || "").trim())
      .replace(/\s+/g, " ")
      .trim();

    // 2) TTS neural audio
    // OpenAI Audio API: /v1/audio/speech
    const ttsResp = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice: VOICE,
        input: cleanText,
        format: "mp3"
      })
    });

    if (!ttsResp.ok) {
      const errText = await ttsResp.text();
      return res.status(500).json({ error: "TTS failed", details: errText, text: cleanText });
    }

    const audioArrayBuffer = await ttsResp.arrayBuffer();
    const audioBase64 = Buffer.from(audioArrayBuffer).toString("base64");

    return res.status(200).json({
      text: cleanText,
      audio: {
        mime: "audio/mpeg",
        base64: audioBase64
      }
    });

  } catch (e) {
    return res.status(500).json({ error: "Server error", details: String(e?.message || e) });
  }
}

// Removes emojis and most pictographs so TTS won't read them.
function stripEmojis(s) {
  return s
    // broad emoji ranges
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
    .replace(/[\u{2600}-\u{27BF}]/gu, "")
    // variation selectors
    .replace(/\uFE0F/gu, "")
    // extra cleanup
    .replace(/[<>]/g, "")
    .trim();
}
