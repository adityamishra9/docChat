// server/lib/http.js
import multer from "multer";

export function uploadErrorHandler(err, _req, res, next) {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err?.message === "PDFs only") {
    return res.status(400).json({ error: "PDFs only" });
  }
  return next(err);
}

export function finalErrorHandler(err, _req, res, _next) {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal Server Error" });
}
