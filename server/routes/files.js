// server/routes/files.js
import { Router } from "express";
import os from "os";
import fs from "fs";
import multer from "multer";
import { ObjectId } from "mongodb";
import { db } from "../db/mongo.js";
import { ensureAuthed } from "../middleware/auth.js";
import { queue } from "../queue/bull.js";
import { streamFileToGridFS, streamGridFSToHttp } from "../services/storage.js";

const r = Router();

// Multer (temp PDFs)
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, file, cb) =>
      cb(
        null,
        `${Date.now()}-${Math.round(Math.random() * 1e9)}-${file.originalname}`
      ),
  }),
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "application/pdf") return cb(new Error("PDFs only"));
    cb(null, true);
  },
  limits: { fileSize: 50 * 1024 * 1024 },
});

/** POST /files/upload */
r.post("/upload", ensureAuthed, upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    if (req.file.mimetype !== "application/pdf")
      return res.status(400).json({ error: "PDFs only" });

    const userId = req.auth()?.userId;
    const col = (await db()).collection("documents");

    const gridId = new ObjectId();
    await streamFileToGridFS(
      req.file.path,
      req.file.originalname,
      req.file.mimetype,
      gridId
    );
    fs.unlink(req.file.path, () => {});

    const _id = new ObjectId();
    const collection = `pdf_${String(_id)}`;
    await col.insertOne({
      _id,
      ownerId: userId,
      name: req.file.originalname,
      size: req.file.size,
      status: "queued",
      pages: null,
      createdAt: new Date(),
      gridId,
      collection,
    });

    await queue.add(
      "file-ready",
      { docId: String(_id), ownerId: userId },
      { removeOnComplete: 100, removeOnFail: 100 }
    );

    res.json({
      uploaded: [
        { id: String(_id), name: req.file.originalname, status: "queued" },
      ],
    });
  } catch (e) {
    console.error(`[${req.reqId}] upload error`, e);
    res.status(500).json({ error: "Upload failed" });
  }
});

/** GET /files/:id — stream original PDF */
r.get("/:id", ensureAuthed, async (req, res) => {
  const userId = req.auth()?.userId;
  const col = (await db()).collection("documents");
  const rec = await col.findOne({
    _id: new ObjectId(req.params.id),
    ownerId: userId,
  });
  if (!rec) return res.status(404).send("Not found");
  return streamGridFSToHttp(rec.gridId, rec.name, res);
});

export default r;
