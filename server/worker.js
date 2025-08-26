import "dotenv/config";
import { Worker } from "bullmq";
import fetch from "node-fetch";
import { QdrantClient } from "@qdrant/js-client-rest";
import { QdrantVectorStore } from "@langchain/qdrant";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { CharacterTextSplitter } from "@langchain/textsplitters";
import fs from "fs";
import path from "path";

/* ------------------------------ ENV ------------------------------ */
const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const COLLECTION = process.env.QDRANT_COLLECTION || "pdf-docs";
const EMBEDDINGS_URL = process.env.EMBEDDINGS_URL || "http://localhost:8001/embeddings";

/* ---------------------------- Tiny JSON-DB ------------------------- */
const dataDir = path.resolve(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });
const dbFile = path.join(dataDir, "db.json");
if (!fs.existsSync(dbFile)) fs.writeFileSync(dbFile, "[]");

function readDB() {
  try { return JSON.parse(fs.readFileSync(dbFile, "utf-8")); } catch { return []; }
}
function writeDB(arr) { fs.writeFileSync(dbFile, JSON.stringify(arr, null, 2)); }
function setStatus(id, status, extra = {}) {
  const arr = readDB();
  const i = arr.findIndex((d) => d.id === id);
  if (i >= 0) {
    arr[i] = { ...arr[i], status, ...extra };
    writeDB(arr);
  }
}

/* -------------------------- Helpers --------------------------- */
async function embedLocally(texts) {
  const res = await fetch(EMBEDDINGS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts }),
  });
  if (!res.ok) throw new Error(`Embed failed ${res.status} ${res.statusText}`);
  const data = await res.json();
  return data.embeddings;
}

new Worker(
  "file-upload-queue",
  async (job) => {
    const { id, path: pdfPath, name } =
      typeof job.data === "string" ? JSON.parse(job.data) : job.data;

    console.log(`\n=== Process job for docId=${id}, file=${pdfPath} ===`);
    setStatus(id, "processing");

    try {
      // Load PDF
      console.time("pdf:load");
      let pages = await new PDFLoader(pdfPath).load();
      console.timeEnd("pdf:load");
      console.log(`pages: ${pages.length}`);

      if (!pages.length || pages.every((p) => !p.pageContent?.trim())) {
        console.warn("No text extracted. (If needed, plug OCR fallback here.)");
      }

      // Split
      console.time("split:chunks");
      const splitter = new CharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 });
      const chunks = await splitter.splitDocuments(pages);
      console.timeEnd("split:chunks");
      console.log(`chunks: ${chunks.length}`);

      // Attach metadata
      const withMeta = chunks.map((c) => ({
        pageContent: c.pageContent,
        metadata: {
          ...(c.metadata || {}),
          page: c.metadata?.loc?.pageNumber ?? c.metadata?.page,
          docId: id,
          name,
        },
      }));

      // Embeddings
      console.time("embed:docs");
      const texts = withMeta.map((c) => c.pageContent);
      const vectors = await embedLocally(texts);
      console.timeEnd("embed:docs");
      console.log(`embeddings: ${vectors.length}`);

      // Index into Qdrant
      console.time("qdrant:index");
      await QdrantVectorStore.fromDocuments(
        withMeta,
        { embedDocuments: async () => vectors, embedQuery: async (q) => (await embedLocally([q]))[0] },
        {
          client: new QdrantClient({ url: QDRANT_URL }),
          collectionName: COLLECTION,
        }
      );
      console.timeEnd("qdrant:index");

      setStatus(id, "ready", { pages: pages.length });
      console.log(`✅ Indexed ${withMeta.length} chunks. Marked docId=${id} READY.`);
    } catch (err) {
      console.error("❌ Worker error:", err);
      setStatus(id, "error", { error: String(err?.message || err) });
      throw err; // keep BullMQ retries/backoff
    }
  },
  {
    concurrency: 4,
    connection: { host: REDIS_HOST, port: REDIS_PORT },
    defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 1000 } },
  }
);
