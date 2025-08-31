// server/routes/documents.js
import { Router } from "express";
import { ObjectId } from "mongodb";
import { db } from "../db/mongo.js";
import { ensureAuthed } from "../middleware/auth.js";
import { makeCursor, parseCursor } from "../utils/cursor.js";
import { queue } from "../queue/bull.js";

const r = Router();

/** GET /documents */
r.get("/", ensureAuthed, async (req, res) => {
  const userId = req.auth?.userId;
  const limit = Math.min(Math.max(parseInt(req.query.limit?.toString() || "20", 10), 1), 100);
  const status = req.query.status?.toString();
  const includeDeleted = String(req.query.includeDeleted || "false") === "true";
  const cursor = req.query.cursor?.toString();

  const col = (await db()).collection("documents");
  const query = { ownerId: userId };
  if (!includeDeleted) Object.assign(query, { deletedAt: { $exists: false } });
  if (status) Object.assign(query, { status });

  if (cursor) {
    const parsed = parseCursor(cursor);
    if (parsed) {
      Object.assign(query, {
        $or: [
          { createdAt: { $lt: parsed.createdAt } },
          { createdAt: parsed.createdAt, _id: { $lt: new ObjectId(parsed.id) } },
        ],
      });
    }
  }

  const docs = await col
    .find(query, { projection: { name: 1, size: 1, pages: 1, status: 1, createdAt: 1 } })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .toArray();

  const items = docs.slice(0, limit).map((d) => ({
    id: String(d._id),
    name: d.name,
    size: d.size,
    pages: d.pages,
    status: d.status,
    createdAt: d.createdAt?.toISOString?.() || d.createdAt,
  }));
  const nextCursor = docs.length > limit ? makeCursor(docs[limit]) : null;

  res.json({ items, nextCursor });
});

/** GET /documents/:id */
r.get("/:id", ensureAuthed, async (req, res) => {
  const userId = req.auth?.userId;
  const col = (await db()).collection("documents");
  const rec = await col.findOne(
    { _id: new ObjectId(req.params.id), ownerId: userId },
    { projection: { name: 1, size: 1, pages: 1, status: 1, createdAt: 1, deletedAt: 1 } }
  );
  if (!rec) return res.status(404).json({ error: "Not found" });
  res.json({
    id: String(rec._id),
    name: rec.name,
    size: rec.size,
    pages: rec.pages,
    status: rec.status,
    createdAt: rec.createdAt?.toISOString?.() || rec.createdAt,
    deletedAt: rec.deletedAt?.toISOString?.(),
  });
});

/** GET /documents/:id/status */
r.get("/:id/status", ensureAuthed, async (req, res) => {
  const userId = req.auth?.userId;
  const col = (await db()).collection("documents");
  const rec = await col.findOne(
    { _id: new ObjectId(req.params.id), ownerId: userId },
    { projection: { status: 1, pages: 1 } }
  );
  if (!rec) return res.status(404).json({ error: "Not found" });
  res.json({ id: String(req.params.id), status: rec.status || null, pages: rec.pages ?? null });
});

/** DELETE /documents/:id (soft default; hard if ?hard=true) */
r.delete("/:id", ensureAuthed, async (req, res) => {
  const userId = req.auth?.userId;
  const hard = String(req.query.hard || "false") === "true";
  const _id = new ObjectId(req.params.id);

  const col = (await db()).collection("documents");
  const doc = await col.findOne({ _id, ownerId: userId });
  if (!doc) return res.status(404).json({ error: "Not found" });

  if (!hard) {
    await col.updateOne({ _id, ownerId: userId }, { $set: { deletedAt: new Date(), status: "deleted" } });
    return res.json({ ok: true, mode: "soft" });
  }

  await col.updateOne({ _id, ownerId: userId }, { $set: { status: "deleting", deletingAt: new Date() } });

  await queue.add(
    "hard-delete",
    { docId: String(_id), ownerId: userId, gridId: String(doc.gridId), collection: doc.collection },
    { removeOnComplete: 100, removeOnFail: 100, attempts: 3, backoff: { type: "exponential", delay: 2000 } }
  );

  res.json({ ok: true, mode: "hard", enqueued: true });
});

/** DELETE /documents (bulk) — hard by default; soft if ?hard=false) */
r.delete("/", ensureAuthed, async (req, res) => {
  const userId = req.auth?.userId;
  const hard = String(req.query.hard || "true") === "true";
  const col = (await db()).collection("documents");

  if (!hard) {
    const r1 = await col.updateMany(
      { ownerId: userId, deletedAt: { $exists: false } },
      { $set: { deletedAt: new Date(), status: "deleted" } }
    );
    return res.json({ ok: true, mode: "soft", matchedCount: r1.matchedCount, modifiedCount: r1.modifiedCount });
  }

  const docs = await col
    .find({ ownerId: userId, deletedAt: { $exists: false } }, { projection: { _id: 1, gridId: 1, collection: 1 } })
    .toArray();

  if (docs.length === 0) {
    return res.json({ ok: true, mode: "hard", enqueued: 0, deletedCount: 0 });
  }

  await col.updateMany(
    { ownerId: userId, deletedAt: { $exists: false } },
    { $set: { status: "deleting", deletingAt: new Date() } }
  );

  await Promise.allSettled(
    docs.map((doc) =>
      queue.add(
        "hard-delete",
        { docId: String(doc._id), ownerId: userId, gridId: String(doc.gridId), collection: doc.collection },
        { removeOnComplete: 100, removeOnFail: 100, attempts: 3, backoff: { type: "exponential", delay: 2000 } }
      )
    )
  );

  res.json({ ok: true, mode: "hard", enqueued: docs.length, deletedCount: docs.length });
});

export default r;
