// server/index.js
import express from "express";
import { clerkMiddleware } from "@clerk/express";
import { ENV } from "./config/env.js";
import { corsMiddleware } from "./middleware/cors.js";
import { requestId } from "./lib/request-id.js";
import health from "./routes/health.js";
import documents from "./routes/documents.js";
import files from "./routes/files.js";
import chat from "./routes/chat.js";
import { uploadErrorHandler, finalErrorHandler } from "./lib/http.js";
import { ensureAuthed, getUserId } from "./middleware/auth.js";
import { sseHandler } from "./realtime/sse.js";
import "./queue/bull.js";      // initialize Bull/QueueEvents connections
import "./queue/handlers.js";  // attach QueueEvents listeners

const app = express();

app.use(corsMiddleware);
app.use(express.json({ limit: "2mb" }));
app.use(clerkMiddleware());
app.use(requestId());

// Health
app.use("/", health);

// SSE (per-user)
app.get("/events", ensureAuthed, (req, res) => {
  const userId = getUserId(req);
  sseHandler(req, res, userId);
});

// APIs
app.use("/documents", documents);
app.use("/files", files);
app.use("/chat", chat);

// Errors
app.use(uploadErrorHandler);
app.use(finalErrorHandler);

// Listen
app.listen(ENV.PORT, () => {
  console.log("ENV →", {
    PORT: ENV.PORT,
    REDIS_HOST: ENV.REDIS_HOST,
    REDIS_PORT: ENV.REDIS_PORT,
    QDRANT_URL: ENV.QDRANT_URL,
    EMBEDDINGS_URL: ENV.EMBEDDINGS_URL,
    GEMINI_KEY_SET: Boolean(ENV.GEMINI_API_KEY),
    CORS_ORIGIN: ENV.CORS_ORIGIN,
  });
  console.log(`Server listening on http://localhost:${ENV.PORT}`);
});
