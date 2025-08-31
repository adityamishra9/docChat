// server/config/env.js
import { fileURLToPath } from "url";
import path from "path";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export const ENV = {
  PORT: Number(process.env.PORT || 8000),
  REDIS_HOST: process.env.REDIS_HOST || "localhost",
  REDIS_PORT: Number(process.env.REDIS_PORT || 6379),
  QDRANT_URL: process.env.QDRANT_URL || "http://localhost:6333",
  EMBEDDINGS_URL: process.env.EMBEDDINGS_URL || "http://localhost:8001/embeddings",
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
  CORS_ORIGIN: (process.env.CORS_ORIGIN || "http://localhost:3000")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean),
  MONGODB_URI: process.env.MONGODB_URI || "mongodb://localhost:27018",
  MONGODB_DB: process.env.MONGODB_DB || "docchat",
};
