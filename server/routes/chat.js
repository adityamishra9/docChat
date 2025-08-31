// server/routes/chat.js
import { Router } from "express";
import { ObjectId } from "mongodb";
import { db } from "../db/mongo.js";
import { ensureAuthed } from "../middleware/auth.js";
import { vectorStoreForCollection } from "../services/vector.js";
import { SYSTEM_PROMPT } from "../services/prompts.js";
import { generateAnswer } from "../services/llm.js";

const r = Router();

/** POST /chat/:docId (body: { content | message | query, topK? }) */
r.post("/:docId", ensureAuthed, async (req, res) => {
  const userId = req.auth()?.userId;
  const docId = req.params.docId;
  const question = (req.body.message ?? req.body.query ?? req.body.content ?? "").trim();
  const topK = Math.min(Math.max(parseInt(req.body.topK ?? "5", 10), 1), 20);
  if (!docId || !question) return res.status(400).json({ error: "Missing docId or message" });

  try {
    const col = (await db()).collection("documents");
    const rec = await col.findOne({ _id: new ObjectId(docId), ownerId: userId });
    if (!rec) return res.status(404).json({ error: "Document not found" });
    if (rec.status !== "ready") return res.status(409).json({ error: "Document not ready" });

    const vectorStore = await vectorStoreForCollection(rec.collection);
    const results = await vectorStore.similaritySearch(question, topK);

    const context = results.map((r) => r.pageContent).join("\n---\n");
    const prompt =
      `${SYSTEM_PROMPT}\n\n` +
      `CONTEXT START\n${context || "(no context)"}\nCONTEXT END\n\n` +
      `QUESTION: ${question}`;

    const answer = await generateAnswer(prompt);

    res.json({
      question,
      answer: answer || "I don't know.",
      // sources: results.map((d, i) => ({
      //   id: i, page: d.metadata?.page, docId, text: d.pageContent,
      // })),
    });
  } catch (err) {
    console.error("Chat failed:", err);
    res.status(500).json({ error: "Chat failed", detail: String(err?.message || err) });
  }
});

/** GET /chat/:docId/messages — client stores messages locally; return empty list */
r.get("/:docId/messages", ensureAuthed, async (_req, res) => {
  res.json({ items: [] });
});

export default r;
