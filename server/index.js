import { fileURLToPath } from "url";
import dotenv from "dotenv";
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
import { clerkMiddleware, getAuth } from "@clerk/express";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

/* ------------------------------ ENV ------------------------------ */
const PORT = Number(process.env.PORT || 8000);
const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const EMBEDDINGS_URL = process.env.EMBEDDINGS_URL || "http://localhost:8001/embeddings";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

const queue = new Queue("file-upload-queue", {
  connection: { host: REDIS_HOST, port: REDIS_PORT },
});

/* ------------------------------ App ------------------------------ */
const app = express();
app.use(cors());
app.use(express.json());

// Attach req.auth via Clerk
app.use(clerkMiddleware()); // extracts session/JWT from Authorization cookie/header :contentReference[oaicite:1]{index=1}

function ensureAuthed(req, res, next) {
  const auth = getAuth(req); // { userId, ... }
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// health (public)
app.get("/", (_req, res) => res.send("HEALTHY"));

console.log("ENV →", {
  PORT, REDIS_HOST, REDIS_PORT, QDRANT_URL, EMBEDDINGS_URL,
  GEMINI_KEY_SET: Boolean(GEMINI_API_KEY),
});

/* --------------------------- Multer (temp) ------------------------ */
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}-${Math.round(Math.random()*1e9)}-${file.originalname}`),
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

// list documents (scoped)
app.get("/documents", ensureAuthed, async (req, res) => {
  const { userId } = getAuth(req);
  const col = (await db()).collection("documents");
  const docs = await col
    .find(
      { ownerId: userId },
      { projection: { name:1, size:1, pages:1, status:1, createdAt:1 } }
    )
    .sort({ createdAt: -1 })
    .toArray();

  res.json(docs.map(d => ({
    id: String(d._id),
    name: d.name,
    size: d.size,
    pages: d.pages,
    status: d.status,
    createdAt: d.createdAt?.toISOString?.() || d.createdAt,
  })));
});

// upload a PDF (store ownerId)
app.post("/upload/pdf", ensureAuthed, upload.single("pdf"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  if (req.file.mimetype !== "application/pdf") return res.status(400).json({ error: "PDFs only" });

  const { userId } = getAuth(req);
  const col = (await db()).collection("documents");

  // 1) temp → GridFS
  const gfs = await bucket();
  const gridId = new ObjectId();
  await new Promise((resolve, reject) => {
    fs.createReadStream(req.file.path)
      .pipe(gfs.openUploadStreamWithId(gridId, req.file.originalname, { contentType: req.file.mimetype }))
      .on("finish", resolve)
      .on("error", reject);
  });

  // 2) remove temp
  fs.unlink(req.file.path, () => {});

  // 3) DB record with ownerId + per-doc collection
  const _id = new ObjectId();
  const collection = `pdf_${String(_id)}`;
  await col.insertOne({
    _id,
    ownerId: userId,  // 🔐 owner scoping
    name: req.file.originalname,
    size: req.file.size,
    status: "queued",
    pages: null,
    createdAt: new Date(),
    gridId,
    collection,
  });

  // 4) enqueue
  await queue.add("file-ready", { docId: String(_id), ownerId: userId }, { removeOnComplete: 100, removeOnFail: 100 });

  res.json({ uploaded: [{ id: String(_id), name: req.file.originalname, status: "queued" }] });
});

// stream original PDF (scoped)
app.get("/files/:id", ensureAuthed, async (req, res) => {
  const { userId } = getAuth(req);
  const col = (await db()).collection("documents");
  const rec = await col.findOne({ _id: new ObjectId(req.params.id), ownerId: userId });
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
app.post("/chat", ensureAuthed, async (req, res) => {
  const { userId } = getAuth(req);
  const docId = req.body.docId ?? null;
  const question = (req.body.message ?? req.body.query ?? "").trim();
  if (!docId || !question) return res.status(400).json({ error: "Missing docId or message" });

  try {
    const col = (await db()).collection("documents");
    const rec = await col.findOne({ _id: new ObjectId(docId), ownerId: userId });
    if (!rec) return res.status(404).json({ error: "Document not found" });
    if (rec.status !== "ready") return res.status(409).json({ error: "Document not ready" });

    const shim = {
      embedQuery: async (t) => (await embedLocally([t]))[0],
      embedDocuments: async (ds) => embedLocally(ds),
    };

    const vectorStore = await QdrantVectorStore.fromExistingCollection(shim, {
      client: new QdrantClient({ url: QDRANT_URL }),
      collectionName: rec.collection,
    });

    const results = await vectorStore.similaritySearch(question, 5);

    const context = results.map(r => r.pageContent).join("\n---\n");
    const prompt =
      `You are a helpful assistant. Answer ONLY using the provided context. ` +
      `If the answer is not present, reply as per your understanding and continue the conversation.\n\n` +
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

// optional debug
app.get("/debug/qdrant/count", ensureAuthed, async (req, res) => {
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
