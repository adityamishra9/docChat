// worker.js
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
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27018";

/** OCR env */
const OCR_ENABLED = String(process.env.OCR_ENABLED || "true") === "true";
const OCR_LANGS = process.env.OCR_LANGS || "eng";
const OCR_DPI = Number(process.env.OCR_DPI || 300);
const OCR_TEXT_MIN_THRESHOLD = Number(process.env.OCR_TEXT_MIN_THRESHOLD || 800); // if below this, we try OCR
const OCR_MAX_PAGES = process.env.OCR_MAX_PAGES
  ? Number(process.env.OCR_MAX_PAGES)
  : undefined; // e.g. 200 to cap runtime on huge PDFs

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
  // 1) Extract per-page docs via PDFLoader
  const pages = await new PDFLoader(tmpPdfPath).load(); // one Document per page
  const totalTextLen = pages.reduce((sum, d) => sum + (d.pageContent?.length || 0), 0);
  return { pages, totalTextLen };
}

/* ------------------------------- OCR fallback ------------------------------- */
/**
 * Use poppler's pdftoppm to rasterize PDF pages to PNGs, then run Tesseract OCR.
 * Requires these system binaries inside the container/host:
 *  - pdftoppm (from poppler-utils)
 *  - tesseract-ocr
 */
async function rasterizePdfToPngs(tmpPdfPath, outDir, dpi = 300, pageLimit) {
  fs.mkdirSync(outDir, { recursive: true });

  // pdftoppm -png -r <dpi> input.pdf outdir/page
  const prefix = path.join(outDir, "page");
  const args = ["-png", `-r`, String(dpi), tmpPdfPath, prefix];

  // If we want to cap pages: pdftoppm supports -singlefile/-f/-l
  // We'll detect page count cheaply by trying to use -l if pageLimit is set.
  if (pageLimit && Number.isFinite(pageLimit)) {
    args.splice(0, 0, "-l", String(pageLimit));
  }

  // Run rasterization
  await execFile("pdftoppm", args);

  // Collect generated files: page-1.png, page-2.png, ...
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
    // Some pdftoppm versions output "page-1.png" with a different pattern "page-01.png"
    const altFiles = fs
      .readdirSync(outDir)
      .filter((f) => f.startsWith("page") && f.endsWith(".png"))
      .map((f) => path.join(outDir, f))
      .sort();
    return altFiles;
  }
  return files;
}

async function ocrImagesToDocuments(pngPaths, docMeta) {
  const docs = [];
  for (let i = 0; i < pngPaths.length; i++) {
    const p = pngPaths[i];
    const pageNum = i + 1;
    const { data } = await Tesseract.recognize(p, OCR_LANGS, {
      // Node version of tesseract.js will download traineddata to ~/.cache by default.
      // You can override with { cachePath: '/tmp/tess-cache' } if needed.
    });
    const text = (data?.text || "").trim();
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
  return docs;
}

/* ---------------------------- Chunk + Index ---------------------------- */

async function chunkAndIndex(name, docId, ownerId, baseDocs, collectionName) {
  // Split into chunks
  const splitter = new CharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });
  const chunks = await splitter.splitDocuments(
    baseDocs.map((c) => ({
      pageContent: c.pageContent,
      metadata: c.metadata,
    }))
  );

  if (!chunks?.length) {
    throw new Error("No chunks created from document text");
  }

  // Pre-embed all chunks
  const texts = chunks.map((c) => c.pageContent);
  const vectors = await embedLocally(texts);
  if (!Array.isArray(vectors) || vectors.length !== chunks.length) {
    throw new Error(
      `Embedding count mismatch (${vectors?.length} != ${chunks.length})`
    );
  }

  // Index into Qdrant
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
  if (!docIdStr) throw new Error("job.data.docId missing");

  const docId = new ObjectId(docIdStr);
  const col = (await db()).collection("documents");

  // Verify document exists
  const rec = await col.findOne({ _id: docId });
  if (!rec) throw new Error("Doc not found");

  // Mark processing early
  await col.updateOne({ _id: docId }, { $set: { status: "processing" } });

  // temp paths
  const tmpPdf = path.join(os.tmpdir(), `${String(docId)}.pdf`);
  const ocrDir = path.join(os.tmpdir(), `${String(docId)}_ocr`);

  try {
    // GridFS → temp
    await gridfsToTempPdf(rec.gridId, tmpPdf);

    // 1) Try native text extraction first
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

    // 2) Decide whether to OCR
    const shouldOCR =
      OCR_ENABLED &&
      (totalTextLen < OCR_TEXT_MIN_THRESHOLD ||
        baseDocs.every((d) => !d.pageContent?.trim()));

    if (shouldOCR) {
      console.log(
        `[worker] ${rec.name}: low text (${totalTextLen}). Running OCR fallback…`
      );

      // Cap pages if configured, to avoid runaway CPU on huge PDFs
      const pngs = await rasterizePdfToPngs(
        tmpPdf,
        ocrDir,
        OCR_DPI,
        OCR_MAX_PAGES
      );
      if (!pngs.length) {
        throw new Error("OCR fallback: no rasterized pages produced");
      }

      const ocrDocs = await ocrImagesToDocuments(pngs, {
        docId: String(docId),
        name: rec.name,
        ownerId: rec.ownerId,
      });

      // If OCR gave something, prefer OCR docs
      const ocrTextLen = ocrDocs.reduce(
        (sum, d) => sum + (d.pageContent?.length || 0),
        0
      );

      if (ocrTextLen > totalTextLen) {
        baseDocs = ocrDocs;
        console.log(
          `[worker] ${rec.name}: OCR text=${ocrTextLen} chars (native=${totalTextLen}). Using OCR output.`
        );
      } else {
        console.log(
          `[worker] ${rec.name}: OCR did not beat native extraction; keeping native text.`
        );
      }
    }

    // 3) Chunk + index
    const { chunks } = await chunkAndIndex(
      rec.name,
      String(docId),
      rec.ownerId,
      baseDocs,
      rec.collection
    );

    // 4) finalize
    await col.updateOne(
      { _id: docId },
      { $set: { status: "ready", pages: baseDocs.length } }
    );
    console.log(
      `✅ [file-ready] ${rec.name}: indexed ${chunks} chunks → ${rec.collection}`
    );

    return { ok: true, chunks, pages: baseDocs.length, usedOCR: shouldOCR };
  } catch (err) {
    console.error("❌ [file-ready] Worker error:", err);
    await col.updateOne(
      { _id: docId },
      { $set: { status: "error", error: String(err?.message || err) } }
    );
    throw err;
  } finally {
    safeUnlink(tmpPdf);
    safeRmdir(ocrDir);
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
    const qc = new QdrantClient({ url: QDRANT_URL });
    await qc.deleteCollection(collection);
    console.log(`[hard-delete] Qdrant collection deleted: ${collection}`);
  } catch (e) {
    console.log(`[hard-delete] Qdrant collection delete skipped/failed: ${collection}`, e?.message);
  }

  try {
    const gfs = await bucket();
    await gfs.delete(gridId);
    console.log(`[hard-delete] GridFS blob deleted: ${gridIdStr}`);
  } catch (e) {
    console.log(`[hard-delete] GridFS delete skipped/failed: ${gridIdStr}`, e?.message);
  }

  await col.deleteOne({ _id: docId, ownerId });
  console.log(`[hard-delete] Mongo record deleted: ${docIdStr}`);

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

/* ----------------------------- Observability ---------------------------- */

worker.on("completed", (job) => {
  console.log(`[worker] ✅ completed "${job.name}" #${job.id}`);
});
worker.on("failed", (job, err) => {
  console.error(`[worker] ❌ failed "${job?.name}" #${job?.id}:`, err?.message || err);
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