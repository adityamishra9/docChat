// server/services/ingest.js
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { execFile as _execFile } from "child_process";
import Tesseract from "tesseract.js";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { bucket } from "../db/mongo.js";

const execFile = promisify(_execFile);

export async function gridfsToTempPdf(gridId, tmpPath) {
  const b = await bucket();
  await new Promise((resolve, reject) => {
    b.openDownloadStream(gridId)
      .pipe(fs.createWriteStream(tmpPath))
      .on("finish", resolve)
      .on("error", reject);
  });
}

export async function extractWithPdfLoader(tmpPdfPath) {
  const pages = await new PDFLoader(tmpPdfPath).load();
  const totalTextLen = pages.reduce(
    (sum, d) => sum + (d.pageContent?.length || 0),
    0
  );
  return { pages, totalTextLen };
}

/**
 * Rasterize with pdftoppm at a given DPI → PNGs, then run Tesseract per page.
 */
export async function rasterizePdfToPngs(tmpPdfPath, outDir, dpi = 300, pageLimit) {
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

export async function ocrImagesToDocuments(pngPaths, docMeta, langs) {
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

export function safeUnlink(p) {
  try { fs.unlinkSync(p); } catch {}
}
export function safeRmdir(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch {}
}

// convenience path makers (optional)
export function tempPdfPathFor(docId) {
  return path.join(os.tmpdir(), `${String(docId)}.pdf`);
}
export function ocrRootFor(docId) {
  return path.join(os.tmpdir(), `${String(docId)}_ocr`);
}
