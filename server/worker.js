import { Worker } from "bullmq";
import fetch from "node-fetch";
import { QdrantClient } from "@qdrant/js-client-rest";
import { QdrantVectorStore } from "@langchain/qdrant";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { CharacterTextSplitter } from "@langchain/textsplitters";
import { fromPath } from "pdf2pic";
import tesseract from "node-tesseract-ocr";

// Call local FastAPI embeddings endpoint
async function embedLocally(texts) {
  const res = await fetch("http://localhost:8001/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts }),
  });
  if (!res.ok) throw new Error(`Embed failed ${res.status} ${res.statusText}`);
  const data = await res.json();
  return data.embeddings;
}

// Fallback OCR: render PDF pages to images and run Tesseract
async function ocrPdf(path) {
  console.log(`OCR: starting OCR fallback for ${path}`);
  let pages = [];
  try {
    const converter = fromPath(path, { density: 200, format: "png" });
    console.log("OCR: converting PDF to images...");
    pages = await converter.bulk(-1);
    console.log(`OCR: rendered ${pages.length} image(s)`);
  } catch (err) {
    console.error("OCR: error rendering PDF to images:", err);
    console.error("Make sure you have GraphicsMagick/ImageMagick installed and on your PATH. e.g. 'brew install graphicsmagick' or 'brew install imagemagick'");
    return [];
  }

  const docs = [];
  for (let i = 0; i < pages.length; i++) {
    const imgPath = pages[i].path;
    console.log(`OCR: processing image [${i + 1}/${pages.length}] -> ${imgPath}`);
    try {
      const text = await tesseract.recognize(imgPath, {
        lang: "eng",
        oem: 1,
        psm: 3,
      });
      console.log(`OCR: extracted ${text.length} chars from page ${i + 1}`);
      docs.push({ pageContent: text, metadata: { page: i + 1 } });
    } catch (err) {
      console.error(`OCR: error on page ${i + 1}:`, err);
    }
  }
  console.log("OCR: completed all pages");
  return docs;
}

new Worker(
  "file-upload-queue",
  async (job) => {
    console.log("\n=== New job started ===");
    console.log("Job data:", job.data);

    const payload = typeof job.data === "string" ? JSON.parse(job.data) : job.data;
    const { path } = payload;

    console.log("Loading PDF from path:", path);
    let docs = [];
    try {
      docs = await new PDFLoader(path).load();
      console.log(`Loaded ${docs.length} page(s) via PDFLoader`);
    } catch (err) {
      console.error("PDFLoader error:", err);
    }

    // If no text pages, fall back to OCR
    if (!docs.length || docs.every(d => !d.pageContent.trim())) {
      console.log("No text found—running OCR fallback");
      docs = await ocrPdf(path);
      console.log(`Loaded ${docs.length} page(s) via OCR`);
    }

    console.log("Splitting documents into chunks...");
    const splitter = new CharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 });
    const chunks = await splitter.splitDocuments(docs);
    console.log(`Created ${chunks.length} chunk(s)`);
    console.log("Sample chunk[0]:", chunks[0]?.pageContent.slice(0, 100));

    console.log("Generating embeddings via local FastAPI...");
    let vectors = [];
    try {
      const texts = chunks.map(c => c.pageContent);
      vectors = await embedLocally(texts);
      console.log(`Generated ${vectors.length} embeddings`);
    } catch (err) {
      console.error("Error during embedding generation:", err);
      throw err;
    }

    console.log("Indexing chunks into Qdrant...");
    try {
      await QdrantVectorStore.fromDocuments(
        chunks,
        { embedDocuments: () => Promise.resolve(vectors), embedQuery: () => Promise.resolve(vectors[0]) },
        {
          client: new QdrantClient({ url: "http://localhost:6333" }),
          collectionName: "pdf-docs",
        }
      );
      console.log(`Indexed ${chunks.length} chunks into Qdrant`);
    } catch (err) {
      console.error("Error indexing into Qdrant:", err);
      throw err;
    }

    console.log("=== Job completed successfully ===\n");
  },
  {
    concurrency: 10,
    connection: { host: "localhost", port: 6379 },
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
    },
  }
);