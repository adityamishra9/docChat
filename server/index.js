import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { Queue } from "bullmq";
import fetch from "node-fetch";
import { QdrantClient } from "@qdrant/js-client-rest";
import { QdrantVectorStore } from "@langchain/qdrant";
import { randomUUID } from "node:crypto";
import mime from "mime";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ------------------------------ ENV & Clients ----------------------------- */
const PORT = Number(process.env.PORT || 8000);
const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const COLLECTION = process.env.QDRANT_COLLECTION || "pdf-docs";
const EMBEDDINGS_URL = process.env.EMBEDDINGS_URL || "http://localhost:8001/embeddings";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyDWYMmlGLC3FTArOY0IaRSzhUCLQpHqbyw";

const queue = new Queue("file-upload-queue", {
  connection: { host: REDIS_HOST, port: REDIS_PORT },
});

/* --------------------------------- Storage -------------------------------- */
const uploadDir = path.resolve(process.cwd(), "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const dataDir = path.resolve(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });
const dbFile = path.join(dataDir, "db.json");
if (!fs.existsSync(dbFile)) fs.writeFileSync(dbFile, "[]");

/* ------------------------------- Tiny JSON-DB ------------------------------ */
function readDB() {
  try {
    return JSON.parse(fs.readFileSync(dbFile, "utf-8"));
  } catch {
    return [];
  }
}
function writeDB(arr) {
  fs.writeFileSync(dbFile, JSON.stringify(arr, null, 2));
}
function upsertDoc(doc) {
  const arr = readDB();
  const i = arr.findIndex((d) => d.id === doc.id);
  if (i >= 0) arr[i] = { ...arr[i], ...doc };
  else arr.unshift(doc);
  writeDB(arr);
}
function setStatus(id, status, extra = {}) {
  const arr = readDB();
  const i = arr.findIndex((d) => d.id === id);
  if (i >= 0) {
    arr[i] = { ...arr[i], status, ...extra };
    writeDB(arr);
  }
}

/* --------------------------------- App ----------------------------------- */
const app = express();
app.use(cors());
app.use(express.json());

console.log("ENV →", {
  PORT,
  REDIS_HOST,
  REDIS_PORT,
  QDRANT_URL,
  COLLECTION,
  EMBEDDINGS_URL,
  GEMINI_KEY_SET: Boolean(GEMINI_API_KEY),
});

/* ------------------------------ Multer setup ------------------------------ */
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) =>
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${file.originalname}`),
});
const upload = multer({ storage });

/* --------------------------------- Routes --------------------------------- */

// Health
app.get("/", (_req, res) => res.send("OK"));

// List documents for the frontend sidebar/command palette
app.get("/documents", (_req, res) => {
  // shape: [{id, name, status, pages?, size?, createdAt}]
  const docs = readDB();
  res.json(docs);
});

// Upload one PDF (returns { uploaded: [ { id, name, status } ] })
app.post("/upload/pdf", upload.single("pdf"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const id = randomUUID();
  const { originalname: name, path: filePath, size } = req.file;

  upsertDoc({
    id,
    name,
    status: "queued",
    size,
    path: filePath, 
    createdAt: new Date().toISOString(),
  });

  console.log("upload: received", { id, name, size, filePath });

  // Enqueue for processing (include id so worker can update DB & metadata)
  await queue.add("file-ready", { id, path: filePath, name }, { removeOnComplete: 50, removeOnFail: 50 });

  res.json({
    uploaded: [{ id, name, status: "queued" }],
  });
});

// Embeddings (helper)
async function embedLocally(texts) {
  const response = await fetch(EMBEDDINGS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts }),
  });
  if (!response.ok) throw new Error(`Embedding failed: ${response.status}`);
  const { embeddings } = await response.json();
  return embeddings;
}

// Chat: { docId, message, sessionId? }
// Chat: { docId, message, sessionId? }
app.post("/chat", async (req, res) => {
  const { docId, message } = req.body || {};
  if (!docId || !message) {
    return res.status(400).json({ error: "Missing 'docId' or 'message' in request body" });
  }

  console.log("\n===== /chat request =====");
  console.log("docId:", docId);
  console.log("query:", String(message).slice(0, 200));

  try {
    // --- Embed query
    console.time("embed:query");
    const shim = {
      embedQuery: async (text) => (await embedLocally([text]))[0],
      embedDocuments: async (docs) => embedLocally(docs),
    };
    const queryVector = await shim.embedQuery(message);
    console.timeEnd("embed:query");
    console.log("embed:query vector dims =", Array.isArray(queryVector) ? queryVector.length : "unknown");

    // --- Vector store
    const client = new QdrantClient({ url: QDRANT_URL });
    const vectorStore = await QdrantVectorStore.fromExistingCollection(shim, {
      client,
      collectionName: COLLECTION,
    });

    // --- Try DOC-SCOPED search first
    console.time("qdrant:search(doc-scoped)");
    const k = 5;
    let resultsWithScore = await vectorStore.similaritySearchWithScore(message, k, { docId });
    console.timeEnd("qdrant:search(doc-scoped)");
    console.log("doc-scoped results:", resultsWithScore.length);

    // If nothing returned, FALL BACK to global search (to still provide context)
    if (!resultsWithScore.length) {
      console.warn("⚠️ No results for docId filter. Falling back to global search. Check worker indexing of metadata.docId");
      console.time("qdrant:search(global)");
      resultsWithScore = await vectorStore.similaritySearchWithScore(message, k);
      console.timeEnd("qdrant:search(global)");
      console.log("global results:", resultsWithScore.length);
      if (resultsWithScore.length) {
        const meta0 = resultsWithScore[0][0].metadata;
        console.log("global[0] meta sample:", {
          docId: meta0?.docId,
          page: meta0?.page,
          name: meta0?.name,
        });
      }
    }

    resultsWithScore.slice(0, k).forEach(([doc, score], i) => {
      console.log(
        `result[${i}] score=${Number(score).toFixed(4)} page=${doc.metadata?.page} docId=${doc.metadata?.docId} len=${doc.pageContent?.length ?? 0}`
      );
    });

    // --- Build concise context
    const context = resultsWithScore
      .map(([d, score], i) =>
        `### Chunk ${i + 1} (score=${Number(score).toFixed(4)}, page=${d.metadata?.page ?? "?"}, docId=${d.metadata?.docId ?? "?"})\n${d.pageContent.slice(0, 1800)}`
      )
      .join("\n\n");

    const prompt = [
      "You are a helpful assistant that MUST answer using ONLY the provided context.",
      "If the answer is not present, reply with exactly: I don't know.",
      "",
      "=== CONTEXT ===",
      context || "(no context found for this query)",
      "",
      "=== QUESTION ===",
      message,
    ].join("\n");

    // --- LLM call (Gemini)
    if (!GEMINI_API_KEY) {
      console.error("FATAL: GEMINI_API_KEY missing");
      return res.status(500).json({ error: "GEMINI_API_KEY not set on server" });
    }

    console.time("llm:gemini");
    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
    const llmRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    console.timeEnd("llm:gemini");

    if (!llmRes.ok) {
      const t = await llmRes.text();
      console.error("Gemini HTTP error:", llmRes.status, t.slice(0, 500));
      return res.status(502).json({ error: "Gemini error", detail: t });
    }

    const data = await llmRes.json();
    const answer =
      data.choices?.[0]?.content?.parts?.[0]?.text ||
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "";

    console.log("answer (first 200):", (answer || "").slice(0, 200));

    res.json({
      answer: answer || "I don't know.",
      sources: resultsWithScore.map(([d, score], i) => ({
        id: i,
        score,
        page: d.metadata?.page,
        docId: d.metadata?.docId,
        text: d.pageContent.slice(0, 400),
      })),
    });
  } catch (err) {
    console.error("Chat failed:", err);
    res.status(500).json({ error: "Chat failed", detail: String(err?.message || err) });
  }
});

app.get("/debug/qdrant/count", async (req, res) => {
  const { docId } = req.query;
  try {
    const client = new QdrantClient({ url: QDRANT_URL });
    const r = await client.count(COLLECTION, {
      exact: true,
      filter: docId ? { must: [{ key: "docId", match: { value: String(docId) } }] } : undefined,
    });
    res.json({ docId: docId || null, points: r.count });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/files/:id", (req, res) => {
  const { id } = req.params;
  const docs = readDB();
  const doc = docs.find((d) => d.id === id);

  if (!doc || !doc.path) return res.status(404).send("File not found");

  // Security: only allow files inside the uploads dir
  const abs = path.resolve(doc.path);
  if (!abs.startsWith(uploadDir + path.sep) && abs !== uploadDir) {
    return res.status(403).send("Forbidden");
  }
  if (!fs.existsSync(abs)) return res.status(404).send("File missing on disk");

  const filename = doc.name || `file-${id}.pdf`;
  const type = mime.getType(abs) || "application/pdf";

  res.setHeader("Content-Type", type);
  // Force inline view (browser PDF viewer)
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(filename)}"`);
  res.setHeader("Cache-Control", "no-store");

  const stream = fs.createReadStream(abs);
  stream.on("error", () => res.status(500).end());
  stream.pipe(res);
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
