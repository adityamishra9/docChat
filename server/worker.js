// server/worker.js
// -----------------------------------------------------------------------------
// DocChat Worker (BullMQ) - Refactored
// - Same features, same libs, cleaner structure
// -----------------------------------------------------------------------------

import "dotenv/config";
import { Worker } from "bullmq";
import { ObjectId } from "mongodb";
import { QdrantClient } from "@qdrant/js-client-rest";

import { db, bucket } from "./db/mongo.js";
import { ENV } from "./config/env.js";
import { chunkAndIndex } from "./services/indexer.js";
import {
  gridfsToTempPdf,
  extractWithPdfLoader,
  rasterizePdfToPngs,
  ocrImagesToDocuments,
  safeUnlink,
  safeRmdir,
  tempPdfPathFor,
  ocrRootFor,
} from "./services/ingest.js";

/* ------------------------------ ENV ------------------------------ */
const REDIS_HOST = ENV.REDIS_HOST;
const REDIS_PORT = ENV.REDIS_PORT;
const QDRANT_URL = ENV.QDRANT_URL;

/** OCR env (kept exactly as before) */
const OCR_ENABLED = String(process.env.OCR_ENABLED || "true") === "true";
const OCR_LANGS = process.env.OCR_LANGS || "eng";
const OCR_DPI_LIST = (process.env.OCR_DPI_LIST || "")
  .split(",")
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => Number.isFinite(n) && n > 0);
const OCR_DPI_FALLBACK = Number(process.env.OCR_DPI || 300);
const EFFECTIVE_DPIS = OCR_DPI_LIST.length ? OCR_DPI_LIST : [OCR_DPI_FALLBACK];
const OCR_TEXT_MIN_THRESHOLD = Number(process.env.OCR_TEXT_MIN_THRESHOLD || 800);
const OCR_MAX_PAGES = process.env.OCR_MAX_PAGES
  ? Number(process.env.OCR_MAX_PAGES)
  : undefined;

/* Debug print of OCR env */
console.log("[worker] OCR settings →", {
  OCR_ENABLED,
  OCR_LANGS,
  EFFECTIVE_DPIS,
  OCR_TEXT_MIN_THRESHOLD,
  OCR_MAX_PAGES,
});

/* ---------------------------- Jobs ---------------------------- */

async function handleFileReady(job) {
  const docIdStr = job.data.docId;
  const ownerIdFromJob = job.data.ownerId;
  console.log("[worker] processing docId:", docIdStr);
  if (!docIdStr) throw new Error("job.data.docId missing");

  const docId = new ObjectId(docIdStr);
  const col = (await db()).collection("documents");

  const rec = await col.findOne({ _id: docId });
  if (!rec) throw new Error("Doc not found");
  const ownerId = ownerIdFromJob || rec.ownerId;

  await col.updateOne({ _id: docId }, { $set: { status: "processing" } });
  try {
    await job.updateProgress({ ownerId, docId: String(docId), status: "processing", pct: 5, stage: "start" });
  } catch {}

  const tmpPdf = tempPdfPathFor(docId);
  const ocrRoot = ocrRootFor(docId);

  try {
    await job.updateProgress({ ownerId, docId: String(docId), status: "processing", pct: 10, stage: "download" });
    await gridfsToTempPdf(rec.gridId, tmpPdf);

    // 1) Native text extraction
    await job.updateProgress({ ownerId, docId: String(docId), status: "processing", pct: 30, stage: "pdf-parse" });
    const { pages, totalTextLen } = await extractWithPdfLoader(tmpPdf);
    let baseDocs = pages.map((c) => ({
      pageContent: c.pageContent || "",
      metadata: {
        page: c.metadata?.loc?.pageNumber ?? c.metadata?.page,
        docId: String(docId),
        name: rec.name,
        ownerId: rec.ownerId,
        ocr: false,
      },
    }));

    // 2) OCR decision
    const shouldOCR =
      OCR_ENABLED &&
      (totalTextLen < OCR_TEXT_MIN_THRESHOLD || baseDocs.every((d) => !d.pageContent?.trim()));

    if (shouldOCR) {
      await job.updateProgress({ ownerId, docId: String(docId), status: "processing", pct: 45, stage: "ocr" });
      console.log(
        `[worker] ${rec.name}: low text (${totalTextLen}). Running OCR fallback across DPIs ${JSON.stringify(
          EFFECTIVE_DPIS
        )} …`
      );

      let best = { docs: null, textLen: -1, meanConf: -1, dpi: null, pages: 0 };

      for (const dpi of EFFECTIVE_DPIS) {
        const dir = `${ocrRoot}/dpi_${dpi}`;
        const pngs = await rasterizePdfToPngs(tmpPdf, dir, dpi, OCR_MAX_PAGES);
        if (!pngs.length) {
          console.warn(`[worker] ${rec.name}: dpi=${dpi} produced 0 PNGs`);
          continue;
        }

        const pass = await ocrImagesToDocuments(
          pngs,
          { docId: String(docId), name: rec.name, ownerId: rec.ownerId },
          OCR_LANGS
        );

        console.log(
          `[worker] ${rec.name}: OCR pass dpi=${dpi} pages=${pngs.length} textLen=${pass.textLen} meanConf=${pass.meanConf?.toFixed?.(
            1
          ) || "n/a"}`
        );

        const better =
          pass.textLen > best.textLen ||
          (pass.textLen === best.textLen && (pass.meanConf || 0) > (best.meanConf || 0));

        if (better) {
          best = { docs: pass.docs, textLen: pass.textLen, meanConf: pass.meanConf || 0, dpi, pages: pngs.length };
        }
      }

      if (!best.docs || best.textLen <= 0) {
        console.warn(`[worker] ${rec.name}: OCR fallback produced no usable text; keeping native.`);
      } else {
        console.log(
          `[worker] ${rec.name}: OCR chosen dpi=${best.dpi} pages=${best.pages} textLen=${best.textLen} meanConf=${best.meanConf.toFixed?.(
            1
          ) || "n/a"}`
        );
        baseDocs = best.docs;
      }
    }

    // 3) Chunk + index (Qdrant)
    await job.updateProgress({ ownerId, docId: String(docId), status: "processing", pct: 70, stage: "chunking" });
    const { chunks } = await chunkAndIndex(baseDocs, rec.collection);
    await job.updateProgress({ ownerId, docId: String(docId), status: "processing", pct: 90, stage: "indexing" });

    await col.updateOne({ _id: docId }, { $set: { status: "ready", pages: baseDocs.length } });
    console.log(`✅ [file-ready] ${rec.name}: indexed ${chunks} chunks → ${rec.collection}`);

    // Return ownerId + docId so server QueueEvents 'completed' can notify the right user
    return { ownerId, docId: String(docId), ok: true, chunks, pages: baseDocs.length, usedOCR: shouldOCR };
  } catch (err) {
    console.error("❌ [file-ready] Worker error:", err);
    await col.updateOne({ _id: docId }, { $set: { status: "error", error: String(err?.message || err) } });
    try {
      await job.updateProgress({ ownerId, docId: String(docId), status: "error", pct: 100, stage: "failed" });
    } catch {}
    throw err;
  } finally {
    safeUnlink(tmpPdf);
    safeRmdir(ocrRoot);
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
  const doc = await col.findOne({ _id: docId, ownerId });
  if (!doc) {
    console.log(`[hard-delete] skip: doc not found or not owned (docId=${docIdStr})`);
    return { skipped: true };
  }

  try {
    // Let UI know it's deleting (SSE listener can show spinner)
    try {
      await job.updateProgress({ ownerId, docId: String(docId), status: "deleting", pct: 10, stage: "start" });
    } catch {}

    const qc = new QdrantClient({ url: QDRANT_URL });
    await qc.deleteCollection(collection);
    console.log(`[hard-delete] Qdrant collection deleted: ${collection}`);
    try {
      await job.updateProgress({ ownerId, docId: String(docId), status: "deleting", pct: 50, stage: "vectors" });
    } catch {}

  } catch (e) {
    console.log(`[hard-delete] Qdrant collection delete skipped/failed: ${collection}`, e?.message);
  }

  try {
    const gfs = await bucket();
    await gfs.delete(gridId);
    console.log(`[hard-delete] GridFS blob deleted: ${gridIdStr}`);
    try {
      await job.updateProgress({ ownerId, docId: String(docId), status: "deleting", pct: 75, stage: "blob" });
    } catch {}
  } catch (e) {
    console.log(`[hard-delete] GridFS delete skipped/failed: ${gridIdStr}`, e?.message);
  }

  await col.deleteOne({ _id: docId, ownerId });
  console.log(`[hard-delete] Mongo record deleted: ${docIdStr}`);

  try {
    await job.updateProgress({ ownerId, docId: String(docId), status: "deleted", pct: 100, stage: "done" });
  } catch {}

  // IMPORTANT: don't return { ownerId, docId } here
  return { deleted: true };
}

/* ------------------------------- Worker bootstrap ------------------------------- */

const worker = new Worker(
  "file-upload-queue",
  async (job) => {
    try {
      if (job.name === "file-ready") return await handleFileReady(job);
      if (job.name === "hard-delete") return await handleHardDelete(job);
      throw new Error(`Unknown job: ${job.name}`);
    } catch (err) {
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

worker.on("completed", (job) => {
  console.log(`[worker] ✅ completed "${job.name}" #${job.id}`);
});
worker.on("failed", (job, err) => {
  console.error(`[worker] ❌ failed "${job?.name}" #${job?.id}:`, err?.message || err);
});

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
