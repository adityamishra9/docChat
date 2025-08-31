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
const EMBEDDINGS_URL =
  process.env.EMBEDDINGS_URL || "http://localhost:8001/embeddings";

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

async function gridfsToTempPdf(gridId, tmpPath) {
  const b = await bucket();
  await new Promise((resolve, reject) => {
    b.openDownloadStream(gridId)
      .pipe(fs.createWriteStream(tmpPath))
      .on("finish", resolve)
      .on("error", reject);
  });
}

function safeUnlink(p) {
  try {
    fs.unlink(p, () => {});
  } catch {}
}

/* ---------------------------- Job handlers ---------------------------- */

async function handleFileReady(job) {
  const docIdStr = job.data.docId;
  if (!docIdStr) throw new Error("job.data.docId missing");

  const docId = new ObjectId(docIdStr);
  const col = (await db()).collection("documents");

  // We intentionally *do not* require ownerId in the worker, since the server
  // enqueues jobs only for the authenticated owner. Still, we verify the doc exists.
  const rec = await col.findOne({ _id: docId });
  if (!rec) throw new Error("Doc not found");

  // Mark processing early to surface progress in UI
  await col.updateOne({ _id: docId }, { $set: { status: "processing" } });

  // 1) GridFS → temp file
  const tmp = path.join(os.tmpdir(), `${String(docId)}.pdf`);
  await gridfsToTempPdf(rec.gridId, tmp);

  try {
    // 2) load pages (one Document per page)
    const pages = await new PDFLoader(tmp).load();
    if (!pages?.length) {
      throw new Error("No pages extracted from PDF");
    }

    // 3) split into chunks
    const splitter = new CharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    const chunks = await splitter.splitDocuments(pages);
    if (!chunks?.length) {
      throw new Error("No chunks created from PDF pages");
    }

    // 4) attach metadata
    const withMeta = chunks.map((c) => ({
      pageContent: c.pageContent,
      metadata: {
        page: c.metadata?.loc?.pageNumber ?? c.metadata?.page,
        docId: String(docId),
        name: rec.name,
        ownerId: rec.ownerId, // useful for audits
      },
    }));

    // 5) embed all chunk texts in a single batch
    const texts = withMeta.map((c) => c.pageContent);
    const vectors = await embedLocally(texts);
    if (!Array.isArray(vectors) || vectors.length !== withMeta.length) {
      throw new Error(
        `Embedding count mismatch (${vectors?.length} != ${withMeta.length})`
      );
    }

    // 6) index into per-doc collection (creates if missing)
    await QdrantVectorStore.fromDocuments(
      withMeta,
      {
        // Use precomputed vectors for documents:
        embedDocuments: async () => vectors,
        // For any query in the future:
        embedQuery: async (q) => (await embedLocally([q]))[0],
      },
      {
        client: new QdrantClient({ url: QDRANT_URL }),
        collectionName: rec.collection,
      }
    );

    // 7) finalize
    await col.updateOne(
      { _id: docId },
      { $set: { status: "ready", pages: pages.length } }
    );
    console.log(
      `✅ [file-ready] ${rec.name}: indexed ${withMeta.length} chunks → ${rec.collection}`
    );

    return { ok: true, chunks: withMeta.length, pages: pages.length };
  } catch (err) {
    console.error("❌ [file-ready] Worker error:", err);
    await col.updateOne(
      { _id: docId },
      { $set: { status: "error", error: String(err?.message || err) } }
    );
    throw err;
  } finally {
    safeUnlink(tmp);
  }
}

async function handleHardDelete(job) {
  const { docId: docIdStr, ownerId, gridId: gridIdStr, collection } = job.data || {};
  if (!docIdStr || !ownerId || !gridIdStr || !collection) {
    throw new Error("hard-delete: missing required fields (docId, ownerId, gridId, collection)");
  }

  const docId = new ObjectId(docIdStr);
  const gridId = new ObjectId(gridIdStr);

  const col = (await db()).collection("documents");
  // Verify the document still belongs to the same owner (safety)
  const doc = await col.findOne({ _id: docId, ownerId });
  if (!doc) {
    // If already gone, nothing to do.
    console.log(`[hard-delete] skip: doc not found or not owned (docId=${docIdStr})`);
    return { skipped: true };
  }

  // 1) Delete Qdrant collection (ignore if already missing)
  try {
    const qc = new QdrantClient({ url: QDRANT_URL });
    await qc.deleteCollection(collection);
    console.log(`[hard-delete] Qdrant collection deleted: ${collection}`);
  } catch (e) {
    console.log(`[hard-delete] Qdrant collection delete skipped/failed: ${collection}`, e?.message);
  }

  // 2) Delete GridFS blob (ignore if already missing)
  try {
    const gfs = await bucket();
    await gfs.delete(gridId);
    console.log(`[hard-delete] GridFS blob deleted: ${gridIdStr}`);
  } catch (e) {
    console.log(`[hard-delete] GridFS delete skipped/failed: ${gridIdStr}`, e?.message);
  }

  // 3) Remove Mongo record
  await col.deleteOne({ _id: docId, ownerId });
  console.log(`[hard-delete] Mongo record deleted: ${docIdStr}`);

  return { deleted: true };
}

/* ------------------------------- Worker ------------------------------- */

const worker = new Worker(
  "file-upload-queue",
  async (job) => {
    try {
      if (job.name === "file-ready") {
        return await handleFileReady(job);
      }
      if (job.name === "hard-delete") {
        return await handleHardDelete(job);
      }
      // Future: add "reindex" or others here.
      throw new Error(`Unknown job: ${job.name}`);
    } catch (err) {
      // Let BullMQ handle retries/backoff; we just log here.
      console.error(`[worker] job "${job.name}" failed:`, err?.message || err);
      throw err;
    }
  },
  {
    concurrency: 4,
    connection: { host: REDIS_HOST, port: REDIS_PORT },
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  }
);

/* ----------------------------- Observability ---------------------------- */

worker.on("completed", (job) => {
  console.log(`[worker] ✅ completed "${job.name}" #${job.id}`);
});

worker.on("failed", (job, err) => {
  console.error(
    `[worker] ❌ failed "${job?.name}" #${job?.id}:`,
    err?.message || err
  );
});

/* --------------------------- Graceful shutdown --------------------------- */

process.on("SIGINT", async () => {
  console.log("Shutting down worker (SIGINT)...");
  await worker.close();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  console.log("Shutting down worker (SIGTERM)...");
  await worker.close();
  process.exit(0);
});
