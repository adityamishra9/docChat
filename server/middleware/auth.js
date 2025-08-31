// server/middleware/auth.js
import { getAuth } from "@clerk/express";

export function ensureAuthed(req, res, next) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  next();
}

export function getUserId(req) {
  return getAuth(req)?.userId || null;
}
