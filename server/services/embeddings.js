// server/services/embeddings.js
import fetch from "node-fetch";
import { ENV } from "../config/env.js";

export async function embedLocally(texts) {
  const r = await fetch(ENV.EMBEDDINGS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts }),
  });
  if (!r.ok) throw new Error(`Embedding failed: ${r.status}`);
  const { embeddings } = await r.json();
  return embeddings;
}
