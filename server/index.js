// server/index.js
// -----------------------------------------------------------------------------
// DocChat Server (Express)
// - Auth: Clerk (cookie-based), per-route enforcement
// - Storage: MongoDB (documents + GridFS), Qdrant (per-doc collection)
// - Queue: BullMQ (file ingest + hard-delete)
// - Realtime: Server-Sent Events (SSE) pushed from BullMQ QueueEvents
// - Goal: Eliminate frontend polling for document status; push updates securely
// -----------------------------------------------------------------------------

import { fileURLToPath } from "url";
import path from "path";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import os from "os";
import fetch from "node-fetch";
import mime from "mime";
import { ObjectId } from "mongodb";
import { QdrantClient } from "@qdrant/js-client-rest";
import { QdrantVectorStore } from "@langchain/qdrant";
import { Queue, QueueEvents } from "bullmq";
import { db, bucket } from "./db.js";
import { clerkMiddleware, getAuth } from "@clerk/express";

// -----------------------------------------------------------------------------
// Boot & ENV
// -----------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const PORT = Number(process.env.PORT || 8000);
const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const EMBEDDINGS_URL =
  process.env.EMBEDDINGS_URL || "http://localhost:8001/embeddings";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const CORS_ORIGIN =
  process.env.CORS_ORIGIN?.split(",").map((s) => s.trim()).filter(Boolean) ||
  ["http://localhost:3000"];

const BULL_QUEUE_NAME = "file-upload-queue";

// -----------------------------------------------------------------------------
// App
// -----------------------------------------------------------------------------
const app = express();

// CORS: allow credentials for cookie auth + SSE
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (CORS_ORIGIN.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "2mb" }));
app.use(clerkMiddleware());

// Request ID for traceability
app.use((req, _res, next) => {
  req.reqId = (Date.now() + Math.random()).toString(36);
  next();
});

// Health
app.get("/", (_req, res) => res.send("HEALTHY"));

console.log("ENV →", {
  PORT,
  REDIS_HOST,
  REDIS_PORT,
  QDRANT_URL,
  EMBEDDINGS_URL,
  GEMINI_KEY_SET: Boolean(GEMINI_API_KEY),
  CORS_ORIGIN,
});

// -----------------------------------------------------------------------------
// BullMQ (Queue + QueueEvents)
// -----------------------------------------------------------------------------
const connection = { host: REDIS_HOST, port: REDIS_PORT };
const queue = new Queue(BULL_QUEUE_NAME, { connection });
const queueEvents = new QueueEvents(BULL_QUEUE_NAME, { connection });

// Live SSE clients per user
/** @type {Map<string, Set<import('express').Response>>} */
const clients = new Map();

function addClient(userId, res) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);
}
function removeClient(userId, res) {
  const set = clients.get(userId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) clients.delete(userId);
}
function pushToUser(userId, event, data) {
  const set = clients.get(userId);
  if (!set || set.size === 0) return;
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) res.write(line);
}

// -----------------------------------------------------------------------------
// Auth helper
// -----------------------------------------------------------------------------
function ensureAuthed(req, res, next) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// -----------------------------------------------------------------------------
// Multer config (temp)
// -----------------------------------------------------------------------------
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, file, cb) =>
      cb(
        null,
        `${Date.now()}-${Math.round(Math.random() * 1e9)}-${file.originalname}`
      ),
  }),
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "application/pdf") return cb(new Error("PDFs only"));
    cb(null, true);
  },
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
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
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-goog-api-key": GEMINI_API_KEY,
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

function makeCursor(doc) {
  const ts =
    doc.createdAt?.toISOString?.() || doc.createdAt || new Date().toISOString();
  return `${ts}_${String(doc._id)}`;
}
function parseCursor(cursor) {
  const idx = cursor.lastIndexOf("_");
  if (idx === -1) return null;
  const createdAtIso = cursor.slice(0, idx);
  const id = cursor.slice(idx + 1);
  const d = new Date(createdAtIso);
  if (isNaN(d.getTime())) return null;
  return { createdAt: d, id };
}

// -----------------------------------------------------------------------------
// Realtime: SSE endpoint (per-user stream)
// -----------------------------------------------------------------------------
app.get("/events", ensureAuthed, (req, res) => {
  const { userId } = getAuth(req);

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  // register client
  addClient(userId, res);

  // initial hello
  res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);

  // heartbeats to keep proxies happy
  const ping = setInterval(() => {
    res.write(`: ping\n\n`);
  }, 15000);

  req.on("close", () => {
    clearInterval(ping);
    removeClient(userId, res);
    res.end();
  });
});

// -----------------------------------------------------------------------------
// QueueEvents → push to SSE + persist status
// Expect worker to call job.updateProgress({ ownerId, docId, pct, stage, status? })
// and to return { ownerId, docId } on completion.
// -----------------------------------------------------------------------------
queueEvents.on("progress", async ({ data }) => {
  // BullMQ progress event payload comes as { jobId, data }
  // We expect worker to include ownerId/docId inside progress data.
  const { ownerId, docId, pct, stage, status } = data || {};
  if (!ownerId || !docId) return;

  // Persist current status for refresh-safe UI
  try {
    const col = (await db()).collection("documents");
    await col.updateOne(
      { _id: new ObjectId(docId), ownerId },
      {
        $set: {
          status: status || "processing",
          updatedAt: new Date(),
          // Optional: store stage/progress for debugging/metrics
          progress: typeof pct === "number" ? pct : undefined,
          stage: stage || undefined,
        },
      }
    );
  } catch (e) {
    console.error("progress persist error:", e);
  }

  // Push live update
  pushToUser(ownerId, "doc", {
    type: "progress",
    docId,
    status: status || "processing",
    pct: typeof pct === "number" ? pct : null,
    stage: stage ?? null,
  });
});

queueEvents.on("completed", async ({ returnvalue }) => {
  const { ownerId, docId, pages } = returnvalue || {};
  if (!ownerId || !docId) return;

  try {
    const col = (await db()).collection("documents");
    await col.updateOne(
      { _id: new ObjectId(docId), ownerId },
      { $set: { status: "ready", updatedAt: new Date() } }
    );
  } catch (e) {
    console.error("completed persist error:", e);
  }

  pushToUser(ownerId, "doc", { type: "completed", docId, status: "ready", pages });
});

queueEvents.on("failed", async ({ failedReason, data }) => {
  const { ownerId, docId } = data || {};
  if (!ownerId || !docId) return;

  try {
    const col = (await db()).collection("documents");
    await col.updateOne(
      { _id: new ObjectId(docId), ownerId },
      {
        $set: {
          status: "error",
          error: failedReason || "Unknown",
          updatedAt: new Date(),
        },
      }
    );
  } catch (e) {
    console.error("failed persist error:", e);
  }

  pushToUser(ownerId, "doc", {
    type: "failed",
    docId,
    status: "error",
    error: failedReason || null,
  });
});

// -----------------------------------------------------------------------------
// Routes: Documents
// -----------------------------------------------------------------------------

/**
 * GET /documents
 * Query:
 *   - limit=1..100 (default 20)
 *   - cursor=<ts_id> (pagination)
 *   - status=ready|queued|processing|error|deleted
 *   - includeDeleted=false|true
 */
app.get("/documents", ensureAuthed, async (req, res) => {
  const { userId } = getAuth(req);
  const limit = Math.min(
    Math.max(parseInt(req.query.limit?.toString() || "20", 10), 1),
    100
  );
  const status = req.query.status?.toString();
  const includeDeleted = String(req.query.includeDeleted || "false") === "true";
  const cursor = req.query.cursor?.toString();

  const col = (await db()).collection("documents");
  const query = { ownerId: userId };

  if (!includeDeleted) Object.assign(query, { deletedAt: { $exists: false } });
  if (status) Object.assign(query, { status });

  if (cursor) {
    const parsed = parseCursor(cursor);
    if (parsed) {
      Object.assign(query, {
        $or: [
          { createdAt: { $lt: parsed.createdAt } },
          { createdAt: parsed.createdAt, _id: { $lt: new ObjectId(parsed.id) } },
        ],
      });
    }
  }

  const docs = await col
    .find(query, {
      projection: { name: 1, size: 1, pages: 1, status: 1, createdAt: 1 },
    })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .toArray();

  const items = docs.slice(0, limit).map((d) => ({
    id: String(d._id),
    name: d.name,
    size: d.size,
    pages: d.pages,
    status: d.status,
    createdAt: d.createdAt?.toISOString?.() || d.createdAt,
  }));

  const nextCursor = docs.length > limit ? makeCursor(docs[limit]) : null;

  res.json({ items, nextCursor });
});

/** GET /documents/:id */
app.get("/documents/:id", ensureAuthed, async (req, res) => {
  const { userId } = getAuth(req);
  const col = (await db()).collection("documents");
  const rec = await col.findOne(
    { _id: new ObjectId(req.params.id), ownerId: userId },
    {
      projection: {
        name: 1,
        size: 1,
        pages: 1,
        status: 1,
        createdAt: 1,
        deletedAt: 1,
      },
    }
  );
  if (!rec) return res.status(404).json({ error: "Not found" });
  res.json({
    id: String(rec._id),
    name: rec.name,
    size: rec.size,
    pages: rec.pages,
    status: rec.status,
    createdAt: rec.createdAt?.toISOString?.() || rec.createdAt,
    deletedAt: rec.deletedAt?.toISOString?.(),
  });
});

/** GET /documents/:id/status */
app.get("/documents/:id/status", ensureAuthed, async (req, res) => {
  const { userId } = getAuth(req);
  const col = (await db()).collection("documents");
  const rec = await col.findOne(
    { _id: new ObjectId(req.params.id), ownerId: userId },
    { projection: { status: 1, pages: 1 } }
  );
  if (!rec) return res.status(404).json({ error: "Not found" });
  res.json({
    id: String(req.params.id),
    status: rec.status || null,
    pages: rec.pages ?? null,
  });
});

/** DELETE /documents/:id (soft by default; hard if ?hard=true) */
app.delete("/documents/:id", ensureAuthed, async (req, res) => {
  const { userId } = getAuth(req);
  const hard = String(req.query.hard || "false") === "true";
  const _id = new ObjectId(req.params.id);

  const col = (await db()).collection("documents");
  const doc = await col.findOne({ _id, ownerId: userId });
  if (!doc) return res.status(404).json({ error: "Not found" });

  if (!hard) {
    await col.updateOne(
      { _id, ownerId: userId },
      { $set: { deletedAt: new Date(), status: "deleted" } }
    );
    return res.json({ ok: true, mode: "soft" });
  }

  await col.updateOne(
    { _id, ownerId: userId },
    { $set: { status: "deleting", deletingAt: new Date() } }
  );

  await queue.add(
    "hard-delete",
    {
      docId: String(_id),
      ownerId: userId,
      gridId: String(doc.gridId),
      collection: doc.collection,
    },
    {
      removeOnComplete: 100,
      removeOnFail: 100,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
    }
  );

  res.json({ ok: true, mode: "hard", enqueued: true });
});

/** DELETE /documents (bulk) — hard by default; soft if ?hard=false) */
app.delete("/documents", ensureAuthed, async (req, res) => {
  const { userId } = getAuth(req);
  const hard = String(req.query.hard || "true") === "true"; // default HARD
  const col = (await db()).collection("documents");

  if (!hard) {
    const r = await col.updateMany(
      { ownerId: userId, deletedAt: { $exists: false } },
      { $set: { deletedAt: new Date(), status: "deleted" } }
    );
    return res.json({
      ok: true,
      mode: "soft",
      matchedCount: r.matchedCount,
      modifiedCount: r.modifiedCount,
    });
  }

  const docs = await col
    .find(
      { ownerId: userId, deletedAt: { $exists: false } },
      { projection: { _id: 1, gridId: 1, collection: 1 } }
    )
    .toArray();

  if (docs.length === 0) {
    return res.json({ ok: true, mode: "hard", enqueued: 0, deletedCount: 0 });
  }

  await col.updateMany(
    { ownerId: userId, deletedAt: { $exists: false } },
    { $set: { status: "deleting", deletingAt: new Date() } }
  );

  await Promise.allSettled(
    docs.map((doc) =>
      queue.add(
        "hard-delete",
        {
          docId: String(doc._id),
          ownerId: userId,
          gridId: String(doc.gridId),
          collection: doc.collection,
        },
        {
          removeOnComplete: 100,
          removeOnFail: 100,
          attempts: 3,
          backoff: { type: "exponential", delay: 2000 },
        }
      )
    )
  );

  res.json({
    ok: true,
    mode: "hard",
    enqueued: docs.length,
    deletedCount: docs.length,
  });
});

// -----------------------------------------------------------------------------
// Routes: Files
// -----------------------------------------------------------------------------

/** POST /files/upload */
app.post(
  "/files/upload",
  ensureAuthed,
  upload.single("pdf"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      if (req.file.mimetype !== "application/pdf")
        return res.status(400).json({ error: "PDFs only" });

      const { userId } = getAuth(req);
      const col = (await db()).collection("documents");

      // 1) temp → GridFS
      const gfs = await bucket();
      const gridId = new ObjectId();
      await new Promise((resolve, reject) => {
        fs.createReadStream(req.file.path)
          .pipe(
            gfs.openUploadStreamWithId(gridId, req.file.originalname, {
              contentType: req.file.mimetype,
            })
          )
          .on("finish", resolve)
          .on("error", reject);
      });

      // 2) remove temp file
      fs.unlink(req.file.path, () => {});

      // 3) DB record with ownerId + per-doc qdrant collection
      const _id = new ObjectId();
      const collection = `pdf_${String(_id)}`;
      await col.insertOne({
        _id,
        ownerId: userId,
        name: req.file.originalname,
        size: req.file.size,
        status: "queued",
        pages: null,
        createdAt: new Date(),
        gridId,
        collection,
      });

      // 4) enqueue worker (include ownerId & docId so QueueEvents can target correctly)
      await queue.add(
        "file-ready",
        { docId: String(_id), ownerId: userId },
        { removeOnComplete: 100, removeOnFail: 100 }
      );

      res.json({
        uploaded: [
          { id: String(_id), name: req.file.originalname, status: "queued" },
        ],
      });
    } catch (e) {
      console.error(`[${req.reqId}] upload error`, e);
      res.status(500).json({ error: "Upload failed" });
    }
  }
);

/** GET /files/:id — stream original PDF */
app.get("/files/:id", ensureAuthed, async (req, res) => {
  const { userId } = getAuth(req);
  const col = (await db()).collection("documents");
  const rec = await col.findOne({
    _id: new ObjectId(req.params.id),
    ownerId: userId,
  });
  if (!rec) return res.status(404).send("Not found");

  res.setHeader("Content-Type", mime.getType(rec.name) || "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${encodeURIComponent(rec.name)}"`
  );
  res.setHeader("Cache-Control", "no-store");

  const gfs = await bucket();
  gfs
    .openDownloadStream(rec.gridId)
    .on("error", () => res.status(500).end())
    .pipe(res);
});

// -----------------------------------------------------------------------------
// Routes: Chat
// -----------------------------------------------------------------------------

/** POST /chat/:docId (body: { content | message | query, topK? }) */
app.post("/chat/:docId", ensureAuthed, async (req, res) => {
  const { userId } = getAuth(req);
  const docId = req.params.docId;
  const question = (
    req.body.message ?? req.body.query ?? req.body.content ?? ""
  ).trim();
  const topK = Math.min(Math.max(parseInt(req.body.topK ?? "5", 10), 1), 20);
  if (!docId || !question)
    return res.status(400).json({ error: "Missing docId or message" });

  try {
    const col = (await db()).collection("documents");
    const rec = await col.findOne({
      _id: new ObjectId(docId),
      ownerId: userId,
    });
    if (!rec) return res.status(404).json({ error: "Document not found" });
    if (rec.status !== "ready")
      return res.status(409).json({ error: "Document not ready" });

    const shim = {
      embedQuery: async (t) => (await embedLocally([t]))[0],
      embedDocuments: async (ds) => embedLocally(ds),
    };

    const vectorStore = await QdrantVectorStore.fromExistingCollection(shim, {
      client: new QdrantClient({ url: QDRANT_URL }),
      collectionName: rec.collection,
    });

    const results = await vectorStore.similaritySearch(question, topK);

    const context = results.map((r) => r.pageContent).join("\n---\n");
    const prompt =
      `You are a helpful assistant. Answer ONLY using the provided context. ` +
      `If the answer is not present, reply as per your understanding and continue the conversation.\n\n` +
      `CONTEXT:\n${context || "(no context)"}\n\nQUESTION: ${question}`;

    const answer = await generateAnswer(prompt);

    res.json({
      question,
      answer: answer || "I don't know.",
      // sources: results.map((d, i) => ({
      //   id: i,
      //   page: d.metadata?.page,
      //   docId,
      //   text: d.pageContent,
      // })),
    });
  } catch (err) {
    console.error("Chat failed:", err);
    res
      .status(500)
      .json({ error: "Chat failed", detail: String(err?.message || err) });
  }
});

/** GET /chat/:docId/messages — client stores messages locally; return empty list */
app.get("/chat/:docId/messages", ensureAuthed, async (_req, res) => {
  res.json({ items: [] });
});

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------
app.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err?.message === "PDFs only") {
    return res.status(400).json({ error: "PDFs only" });
  }
  return next(err);
});

app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

// -----------------------------------------------------------------------------
// Listen
// -----------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
