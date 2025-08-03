import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import { Queue } from "bullmq";
import fetch from "node-fetch";
import { QdrantClient } from "@qdrant/js-client-rest";
import { QdrantVectorStore } from "@langchain/qdrant";

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY || "AIzaSyDWYMmlGLC3FTArOY0IaRSzhUCLQpHqbyw";

const queue = new Queue("file-upload-queue", {
  connection: { host: "localhost", port: 6379 },
});

const uploadDir = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) =>
    cb(
      null,
      `${Date.now()}-${Math.round(Math.random() * 1e9)}-${file.originalname}`
    ),
});
const upload = multer({ storage });

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => res.send("Hello World"));

app.post("/upload/pdf", upload.single("pdf"), (req, res) => {
  const { originalname: filename, path: filePath, destination } = req.file;
  queue.add("file-ready", { filename, path: filePath, destination });
  res.json({ message: "Upload successful", file: req.file });
});

async function embedLocally(texts) {
  const response = await fetch("http://localhost:8001/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts }),
  });
  if (!response.ok) {
    throw new Error(`Embedding failed with status ${response.status}`);
  }
  const { embeddings } = await response.json();
  return embeddings;
}

async function generateAnswer(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-goog-api-key": GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.content || data.candidates?.[0]?.content || "";
}

app.post("/chat", async (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ error: "Missing 'query' in request body" });
  }
  const shim = {
    embedQuery: async (text) => (await embedLocally([text]))[0],
    embedDocuments: async (docs) => embedLocally(docs),
  };
  const vectorStore = await QdrantVectorStore.fromExistingCollection(shim, {
    client: new QdrantClient({ url: "http://localhost:6333" }),
    collectionName: "pdf-docs",
  });
  const results = await vectorStore.similaritySearch(query, 5);

  const systemPrompt = `You are a helpful assistant. Answer the user's question based on the provided documents. If you don't know the answer, say "I don't know".`;
  const context = results.map((d) => d.pageContent).join("\n---\n");
  const fullPrompt = `${systemPrompt}\n\nCONTEXT:\n${context}\n\nQUESTION: ${query}`;

  try {
    const answer = await generateAnswer(fullPrompt);
    res.json({
      query,
      answer,
      sources: results.map((d, i) => ({ id: i, text: d.pageContent })),
    });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ error: "LLM generation failed", detail: error.message });
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
