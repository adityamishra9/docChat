import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import os from "os";
import path from "path";
import { Queue } from "bullmq";
import fetch from "node-fetch";
import mime from "mime";
import { ObjectId } from "mongodb";
import { QdrantClient } from "@qdrant/js-client-rest";
import { QdrantVectorStore } from "@langchain/qdrant";
import { db, bucket } from "./db.js";

/* ------------------------------ ENV ------------------------------ */
const PORT = Number(process.env.PORT || 8000);
const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const EMBEDDINGS_URL = process.env.EMBEDDINGS_URL || "http://localhost:8001/embeddings";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyDWYMmlGLC3FTArOY0IaRSzhUCLQpHqbyw";
const queue = new Queue("file-upload-queue", { connection: { host: REDIS_HOST, port: REDIS_PORT } });

/* ------------------------------ App ------------------------------ */
const app = express();
app.use(cors());
app.use(express.json());

console.log("ENV →", {
  PORT, REDIS_HOST, REDIS_PORT, QDRANT_URL,
  EMBEDDINGS_URL, GEMINI_KEY_SET: Boolean(GEMINI_API_KEY)
});

/* --------------------------- Multer (temp) ------------------------ */
/** write to OS temp dir, then stream into GridFS and delete */
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random()*1e9)}-${file.originalname}`)
  }),
});

/* ----------------------------- Helpers --------------------------- */
async function embedLocally(texts) {
  const r = await fetch(EMBEDDINGS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts }),
  });
  if (!r.ok) throw new Error(`Embedding failed: ${r.status}`);
  const { embeddings } = await r.json();
  return embeddings;
}

async function generateAnswer(prompt) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-goog-api-key": GEMINI_API_KEY },
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

/* ------------------------------ Routes --------------------------- */

// health
app.get("/", (_req, res) => res.send("OK"));

// list documents (minimal fields used by your UI)
app.get("/documents", async (_req, res) => {
  const col = (await db()).collection("documents");
  const docs = await col.find({}, { projection: { name:1, size:1, pages:1, status:1, createdAt:1 } })
                        .sort({ createdAt: -1 }).toArray();
  res.json(docs.map(d => ({
    id: String(d._id),
    name: d.name,
    size: d.size,
    pages: d.pages,
    status: d.status,
    createdAt: d.createdAt?.toISOString?.() || d.createdAt,
  })));
});

// upload a PDF (keeps endpoint shape)
app.post("/upload/pdf", upload.single("pdf"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  if (req.file.mimetype !== "application/pdf") return res.status(400).json({ error: "PDFs only" });

  const col = (await db()).collection("documents");

  // 1) stream temp file → GridFS
  const gfs = await bucket();
  const gridId = new ObjectId();
  await new Promise((resolve, reject) => {
    fs.createReadStream(req.file.path)
      .pipe(gfs.openUploadStreamWithId(gridId, req.file.originalname, { contentType: req.file.mimetype }))
      .on("finish", resolve)
      .on("error", reject);
  });

  // 2) remove temp file
  fs.unlink(req.file.path, () => {});

  // 3) create document record (per-doc Qdrant collection)
  const _id = new ObjectId();
  const collection = `pdf_${String(_id)}`;
  await col.insertOne({
    _id,
    name: req.file.originalname,
    size: req.file.size,
    status: "queued",
    pages: null,
    createdAt: new Date(),
    gridId,
    collection,
  });

  // 4) enqueue
  await queue.add("file-ready", { docId: String(_id) }, { removeOnComplete: 100, removeOnFail: 100 });

  res.json({ uploaded: [{ id: String(_id), name: req.file.originalname, status: "queued" }] });
});

// stream original PDF from GridFS
app.get("/files/:id", async (req, res) => {
  const col = (await db()).collection("documents");
  const rec = await col.findOne({ _id: new ObjectId(req.params.id) });
  if (!rec) return res.status(404).send("Not found");

  res.setHeader("Content-Type", mime.getType(rec.name) || "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(rec.name)}"`);
  res.setHeader("Cache-Control", "no-store");

  const gfs = await bucket();
  gfs.openDownloadStream(rec.gridId)
    .on("error", () => res.status(500).end())
    .pipe(res);
});

// chat → embed query → search that doc's collection → Gemini
app.post("/chat", async (req, res) => {
  const docId = req.body.docId ?? null;
  const question = (req.body.message ?? req.body.query ?? "").trim();
  if (!docId || !question) return res.status(400).json({ error: "Missing docId or message" });

  try {
    const col = (await db()).collection("documents");
    const rec = await col.findOne({ _id: new ObjectId(docId) });
    if (!rec) return res.status(404).json({ error: "Document not found" });
    if (rec.status !== "ready") return res.status(409).json({ error: "Document not ready" });

    const shim = {
      embedQuery: async (t) => (await embedLocally([t]))[0],
      embedDocuments: async (ds) => embedLocally(ds),
    };

    const vectorStore = await QdrantVectorStore.fromExistingCollection(shim, {
      client: new QdrantClient({ url: QDRANT_URL }),
      collectionName: rec.collection, // per-PDF collection
    });

    const k = 5;
    const results = await vectorStore.similaritySearch(question, k);

    const context = results.map(r => r.pageContent).join("\n---\n");
    const prompt =
      `You are a helpful assistant. Answer ONLY using the provided context. ` +
      `If the answer is not present, reply as per your understanding, You can also converse with the user\n\n` +
      `CONTEXT:\n${context || "(no context)"}\n\nQUESTION: ${question}`;

    const answer = await generateAnswer(prompt);

    res.json({
      question,
      answer: answer || "I don't know.",
      sources: results.map((d, i) => ({
        id: i,
        page: d.metadata?.page,
        docId,
        text: d.pageContent,
      })),
    });
  } catch (err) {
    console.error("Chat failed:", err);
    res.status(500).json({ error: "Chat failed", detail: String(err?.message || err) });
  }
});

// optional debug: count points in a specific collection
app.get("/debug/qdrant/count", async (req, res) => {
  const collection = String(req.query.collection || "");
  if (!collection) return res.status(400).json({ error: "collection required" });
  try {
    const client = new QdrantClient({ url: QDRANT_URL });
    const r = await client.count(collection, { exact: true });
    res.json({ collection, points: r.count });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
