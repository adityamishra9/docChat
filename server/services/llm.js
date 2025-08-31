// server/services/llm.js
import fetch from "node-fetch";
import { ENV } from "../config/env.js";

export async function generateAnswer(prompt) {
  if (!ENV.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-goog-api-key": ENV.GEMINI_API_KEY,
    },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!r.ok) throw new Error(`Gemini error ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return (
    data.choices?.[0]?.content?.parts?.[0]?.text ||
    data.candidates?.[0]?.content?.parts?.[0]?.text ||
    ""
  );
}
