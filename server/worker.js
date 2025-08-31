// worker.js
// -----------------------------------------------------------------------------
// DocChat Worker (BullMQ)
// - Handles: file-ready (ingest/index PDF), hard-delete (purge vector + blob + row)
// - Emits BullMQ progress events with { ownerId, docId, status, pct, stage }
// - Returns { ownerId, docId } for file-ready so QueueEvents 'completed' can target SSE
// -----------------------------------------------------------------------------

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
import { promisify } from "util";
import { execFile as _execFile } from "child_process";
import Tesseract from "tesseract.js";

const execFile = promisify(_execFile);

/* ------------------------------ ENV ------------------------------ */
const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const EMBEDDINGS_URL =
  process.env.EMBEDDINGS_URL || "http://localhost:8001/embeddings";

/** OCR env */
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
    fs.unlinkSync(p);
  } catch {}
}
function safeRmdir(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {}
}

/* ---------------------------- PDF text extraction ---------------------------- */

async function extractWithPdfLoader(tmpPdfPath) {
  const pages = await new PDFLoader(tmpPdfPath).load();
  const totalTextLen = pages.reduce(
    (sum, d) => sum + (d.pageContent?.length || 0),
    0
  );
  return { pages, totalTextLen };
}

/* ------------------------------- OCR fallback ------------------------------- */
/**
 * Rasterize with pdftoppm at a given DPI → PNGs, then run Tesseract per page.
 */
async function rasterizePdfToPngs(tmpPdfPath, outDir, dpi = 300, pageLimit) {
  fs.mkdirSync(outDir, { recursive: true });
  const prefix = path.join(outDir, "page");

  const args = ["-png", "-r", String(dpi), tmpPdfPath, prefix];
  if (pageLimit && Number.isFinite(pageLimit)) {
    // limit last page (from 1) e.g. -l 200
    args.unshift("-l", String(pageLimit));
  }
  await execFile("pdftoppm", args);

  const files = fs
    .readdirSync(outDir)
    .filter((f) => f.startsWith("page-") && f.endsWith(".png"))
    .sort((a, b) => {
      const ai = Number(a.replace("page-", "").replace(".png", ""));
      const bi = Number(b.replace("page-", "").replace(".png", ""));
      return ai - bi;
    })
    .map((f) => path.join(outDir, f));

  if (!files.length) {
    const alt = fs
      .readdirSync(outDir)
      .filter((f) => f.startsWith("page") && f.endsWith(".png"))
      .map((f) => path.join(outDir, f))
      .sort();
    return alt;
  }
  return files;
}

async function ocrImagesToDocuments(pngPaths, docMeta, langs) {
  const docs = [];
  let sumConf = 0;
  let confCount = 0;

  for (let i = 0; i < pngPaths.length; i++) {
    const p = pngPaths[i];
    const pageNum = i + 1;
    const { data } = await Tesseract.recognize(p, langs);
    const text = (data?.text || "").trim();
    const conf = Number.isFinite(data?.confidence) ? Number(data.confidence) : undefined;
    if (Number.isFinite(conf)) {
      sumConf += conf;
      confCount += 1;
    }
    docs.push({
      pageContent: text,
      metadata: {
        page: pageNum,
        docId: docMeta.docId,
        name: docMeta.name,
        ownerId: docMeta.ownerId,
        ocr: true,
      },
    });
  }

  const textLen = docs.reduce((s, d) => s + (d.pageContent?.length || 0), 0);
  const meanConf = confCount ? sumConf / confCount : null;

  return { docs, textLen, meanConf };
}

/* ---------------------------- Chunk + Index ---------------------------- */

async function chunkAndIndex(name, docId, ownerId, baseDocs, collectionName) {
  const splitter = new CharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 });
  const chunks = await splitter.splitDocuments(
    baseDocs.map((c) => ({ pageContent: c.pageContent, metadata: c.metadata }))
  );
  if (!chunks?.length) throw new Error("No chunks created from document text");

  const texts = chunks.map((c) => c.pageContent);
  const vectors = await embedLocally(texts);
  if (!Array.isArray(vectors) || vectors.length !== chunks.length) {
    throw new Error(`Embedding count mismatch (${vectors?.length} != ${chunks.length})`);
  }

  await QdrantVectorStore.fromDocuments(
    chunks,
    {
      embedDocuments: async () => vectors,
      embedQuery: async (q) => (await embedLocally([q]))[0],
    },
    {
      client: new QdrantClient({ url: QDRANT_URL }),
      collectionName,
    }
  );

  return { chunks: chunks.length };
}

/* ---------------------------- Job handlers ---------------------------- */

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

  const tmpPdf = path.join(os.tmpdir(), `${String(docId)}.pdf`);
  const ocrRoot = path.join(os.tmpdir(), `${String(docId)}_ocr`);

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
        const dir = path.join(ocrRoot, `dpi_${dpi}`);
        const pngs = await rasterizePdfToPngs(tmpPdf, dir, dpi, OCR_MAX_PAGES);
        if (!pngs.length) {
          console.warn(`[worker] ${rec.name}: dpi=${dpi} produced 0 PNGs`);
          continue;
        }

        const pass = await ocrImagesToDocuments(
          pngs,
          {
            docId: String(docId),
            name: rec.name,
            ownerId: rec.ownerId,
          },
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
          best = {
            docs: pass.docs,
            textLen: pass.textLen,
            meanConf: pass.meanConf || 0,
            dpi,
            pages: pngs.length,
          };
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

    // 3) Chunk + index
    await job.updateProgress({ ownerId, docId: String(docId), status: "processing", pct: 70, stage: "chunking" });
    const { chunks } = await chunkAndIndex(
      rec.name,
      String(docId),
      rec.ownerId,
      baseDocs,
      rec.collection
    );
    await job.updateProgress({ ownerId, docId: String(docId), status: "processing", pct: 90, stage: "indexing" });

    await col.updateOne(
      { _id: docId },
      { $set: { status: "ready", pages: baseDocs.length } }
    );

    console.log(`✅ [file-ready] ${rec.name}: indexed ${chunks} chunks → ${rec.collection}`);

    // Return ownerId + docId so server QueueEvents 'completed' can notify the right user
    return {
      ownerId,
      docId: String(docId),
      ok: true,
      chunks,
      pages: baseDocs.length,
      usedOCR: shouldOCR,
    };
  } catch (err) {
    console.error("❌ [file-ready] Worker error:", err);
    await col.updateOne(
      { _id: docId },
      { $set: { status: "error", error: String(err?.message || err) } }
    );
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

  // IMPORTANT: don't return { ownerId, docId } here, to avoid server's generic
  // 'completed' handler marking it as "ready". Keep payload minimal.
  return { deleted: true };
}

/* ------------------------------- Worker ------------------------------- */

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