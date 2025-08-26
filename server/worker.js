import "dotenv/config";
import { Worker } from "bullmq";
import fs from "fs";
import os from "os";
import path from "path";
import { ObjectId } from "mongodb";
import fetch from "node-fetch";
import { QdrantClient } from "@qdrant/js-client-rest";
import { QdrantVectorStore } from "@langchain/qdrant";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { CharacterTextSplitter } from "@langchain/textsplitters";
import { db, bucket } from "./db.js";

/* ------------------------------ ENV ------------------------------ */
const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const EMBEDDINGS_URL = process.env.EMBEDDINGS_URL || "http://localhost:8001/embeddings";

/* ---------------------------- Helpers ---------------------------- */
async function embedLocally(texts) {
  const r = await fetch(EMBEDDINGS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts }),
  });
  if (!r.ok) throw new Error(`Embed failed ${r.status}`);
  const data = await r.json();
  return data.embeddings;
}

/* ------------------------------- Worker -------------------------- */
new Worker(
  "file-upload-queue",
  async (job) => {
    const docId = new ObjectId(job.data.docId);
    const col = (await db()).collection("documents");
    const rec = await col.findOne({ _id: docId });
    if (!rec) throw new Error("Doc not found");

    await col.updateOne({ _id: docId }, { $set: { status: "processing" } });

    // 1) GridFS → temp file
    const tmp = path.join(os.tmpdir(), `${String(docId)}.pdf`);
    await new Promise((resolve, reject) => {
      bucket().then(b =>
        b.openDownloadStream(rec.gridId)
         .pipe(fs.createWriteStream(tmp))
         .on("finish", resolve)
         .on("error", reject)
      );
    });

    try {
      // 2) load pages
      const pages = await new PDFLoader(tmp).load();

      // 3) split
      const splitter = new CharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 });
      const chunks = await splitter.splitDocuments(pages);

      // 4) attach metadata
      const withMeta = chunks.map(c => ({
        pageContent: c.pageContent,
        metadata: {
          page: c.metadata?.loc?.pageNumber ?? c.metadata?.page,
          docId: String(docId),
          name: rec.name,
        },
      }));

      // 5) embed
      const vectors = await embedLocally(withMeta.map(c => c.pageContent));

      // 6) index into this doc’s own collection
      await QdrantVectorStore.fromDocuments(
        withMeta,
        { embedDocuments: async () => vectors, embedQuery: async (q) => (await embedLocally([q]))[0] },
        {
          client: new QdrantClient({ url: QDRANT_URL }),
          collectionName: rec.collection, // per-PDF
        }
      );

      await col.updateOne({ _id: docId }, { $set: { status: "ready", pages: pages.length } });
      console.log(`✅ ${rec.name}: indexed ${withMeta.length} chunks → ${rec.collection}`);
    } catch (err) {
      console.error("❌ Worker error:", err);
      await col.updateOne({ _id: docId }, { $set: { status: "error", error: String(err?.message || err) } });
      throw err;
    } finally {
      fs.unlink(tmp, () => {});
    }
  },
  {
    concurrency: 4,
    connection: { host: REDIS_HOST, port: REDIS_PORT },
    defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 1000 } },
  }
);
