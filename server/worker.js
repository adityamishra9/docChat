// worker.js
import { Worker } from "bullmq";
import fetch from "node-fetch";
import { QdrantClient } from "@qdrant/js-client-rest";
import { QdrantVectorStore } from "@langchain/qdrant";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { CharacterTextSplitter } from "@langchain/textsplitters";

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

new Worker(
  "file-upload-queue",
  async (job) => {
    console.log("\n=== New job started ===");
    console.log("Job data:", job.data);

    const payload = typeof job.data === "string" ? JSON.parse(job.data) : job.data;
    const { path } = payload;

    console.log("Loading PDF from path:", path);
    const docs = await new PDFLoader(path).load();
    console.log(`Loaded ${docs.length} page(s)`);

    console.log("Splitting documents into chunks...");
    const splitter = new CharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 });
    const chunks = await splitter.splitDocuments(docs);
    console.log(`Created ${chunks.length} chunk(s)`);
    console.log("Sample chunk[0]:", chunks[0]?.pageContent.slice(0, 100));

    console.log("Generating embeddings via local FastAPI...");
    let vectors;
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
