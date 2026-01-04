export default async function handler(req, res) {
  try {
    // HEALTH CHECK: useful from browser
    if (req.method === "GET") {
      return res.status(200).json({
        ok: true,
        route: "/api/emma",
        methods: ["POST"],
        hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
        textModel: process.env.EMMA_TEXT_MODEL || "gpt-4o-mini",
        ttsModel: process.env.EMMA_TTS_MODEL || "gpt-4o-mini-tts",
        voice: process.env.EMMA_VOICE || "alloy"
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: "Missing OPENAI_API_KEY",
        fix: "Set OPENAI_API_KEY in Vercel → Project → Settings → Environment Variables (Production) and redeploy."
      });
    }

    const {
      lang = "it-IT",
      age_band = "3-5",
      child_id = "bimbo",
      transcript = "",
      drawing_summary = {},
      last_events = []
    } = req.body || {};

    const TEXT_MODEL = process.env.EMMA_TEXT_MODEL || "gpt-4o-mini";
    const TTS_MODEL  = process.env.EMMA_TTS_MODEL  || "gpt-4o-mini-tts";
    const VOICE      = process.env.EMMA_VOICE      || "alloy";

    const ageStyle =
      age_band === "3-5" ? "very short sentences, simple words, one step at a time"
    : age_band === "6-8" ? "short sentences, simple causal questions"
    : "child-friendly language, encourage hypothesis gently";

    const sys = `
You are EMMA, a gentle cognitive companion for children.
Language locale: ${lang}.
Style: ${ageStyle}.
Rules:
- Do NOT use emojis or emoticons.
- Do NOT quote or imitate the child's mispronounced words. Never repeat the transcript.
- Be warm, curious, encouraging. No judgement.
- Ask at most ONE question.
- Focus on causal thinking: change one thing, see what happens.
- Keep it under 60 words.
`.trim();

    const user = {
      child_profile: { child_id, age_band, lang },
      drawing_summary,
      // private signal; must not be repeated
      child_spoken_signal: transcript,
      recent_events: Array.isArray(last_events) ? last_events.slice(-10) : []
    };

    // 1) Generate text
    const textResp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
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
      return res.status(500).json({
        error: "Text generation failed",
        details: errText.slice(0, 2000)
      });
    }

    const textJson = await textResp.json();
    const rawText = (textJson && textJson.output_text) ? textJson.output_text : "";
    const cleanText = stripEmojis(String(rawText || "").trim()).replace(/\s+/g, " ").trim();

    if (!cleanText) {
      return res.status(500).json({ error: "Empty AI text output" });
    }

    // 2) TTS
    const ttsResp = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
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
      return res.status(500).json({
        error: "TTS failed",
        details: errText.slice(0, 2000),
        text: cleanText
      });
    }

    const audioBuf = await ttsResp.arrayBuffer();
    const audioBase64 = Buffer.from(audioBuf).toString("base64");

    return res.status(200).json({
      text: cleanText,
      audio: { mime: "audio/mpeg", base64: audioBase64 }
    });

  } catch (e) {
    return res.status(500).json({
      error: "Server error",
      details: String(e?.message || e)
    });
  }
}

function stripEmojis(s) {
  return s
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
    .replace(/[\u{2600}-\u{27BF}]/gu, "")
    .replace(/\uFE0F/gu, "")
    .trim();
}
