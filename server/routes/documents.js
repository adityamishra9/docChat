// server/routes/documents.js
import { Router } from "express";
import { ObjectId } from "mongodb";
import { db } from "../db/mongo.js";
import { ensureAuthed } from "../middleware/auth.js";
import { makeCursor, parseCursor } from "../utils/cursor.js";
import { queue } from "../queue/bull.js";
import { QdrantClient } from "@qdrant/js-client-rest";
import { ENV } from "../config/env.js";
import { pushToUser } from "../realtime/sse.js";

const r = Router();
const qc = new QdrantClient({ url: ENV.QDRANT_URL });

async function collectionHasAnyPoints(collection) {
  try {
    // Try to read collection info (newer Qdrant exposes points_count)
    const info = await qc.getCollection(collection).catch(() => null);
    if (typeof info?.points_count === "number") return info.points_count > 0;

    // Fallback: scroll 1 point
    const sc = await qc.scroll(collection, { limit: 1 }).catch(() => null);
    return Array.isArray(sc?.points) && sc.points.length > 0;
  } catch {
    return false;
  }
}

/** GET /documents (with auto-reconcile of stale processing/queued) */
r.get("/", ensureAuthed, async (req, res) => {
  const userId = req.auth()?.userId;
  const limit = Math.min(
    Math.max(parseInt(req.query.limit?.toString() || "20", 10), 1),
    100
  );
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

  // First pass
  let docs = await col
    .find(query, { projection: { name: 1, size: 1, pages: 1, status: 1, createdAt: 1, collection: 1 } })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .toArray();

  // Auto-reconcile stale ones (>20s in processing/queued)
  const now = Date.now();
  const stale = docs.filter(
    (d) =>
      (d.status === "processing" || d.status === "queued") &&
      d.collection &&
      d.createdAt &&
      now - new Date(d.createdAt).getTime() > 20_000
  );

  if (stale.length) {
    await Promise.all(
      stale.map(async (d) => {
        const ok = await collectionHasAnyPoints(d.collection);
        if (ok) {
          await col.updateOne(
            { _id: d._id, ownerId: userId },
            { $set: { status: "ready", updatedAt: new Date() } }
          );
          pushToUser(userId, "doc", { type: "completed", docId: String(d._id), status: "ready" });
        }
      })
    );

    // Re-read list to reflect fixes
    docs = await col
      .find(query, { projection: { name: 1, size: 1, pages: 1, status: 1, createdAt: 1, collection: 1 } })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .toArray();
  }

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
  const userId = req.auth()?.userId;
  const col = (await db()).collection("documents");
  const rec = await col.findOne(
    { _id: new ObjectId(req.params.id), ownerId: userId },
    {
      projection: {
        name: 1, size: 1, pages: 1, status: 1, createdAt: 1, deletedAt: 1, collection: 1,
      },
    }
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
  const userId = req.auth()?.userId;
  const col = (await db()).collection("documents");
  const rec = await col.findOne(
    { _id: new ObjectId(req.params.id), ownerId: userId },
    { projection: { status: 1, pages: 1 } }
  );
  if (!rec) return res.status(404).json({ error: "Not found" });
  res.json({ id: String(req.params.id), status: rec.status || null, pages: rec.pages ?? null });
});

/** POST /documents/:id/reconcile — manual Retry */
r.post("/:id/reconcile", ensureAuthed, async (req, res) => {
  const userId = req.auth()?.userId;
  const _id = new ObjectId(req.params.id);
  const col = (await db()).collection("documents");
  const doc = await col.findOne({ _id, ownerId: userId }, { projection: { collection: 1, status: 1 } });
  if (!doc) return res.status(404).json({ ok: false, reason: "not_found" });

  const ok = doc.collection ? await collectionHasAnyPoints(doc.collection) : false;
  if (ok) {
    await col.updateOne({ _id, ownerId: userId }, { $set: { status: "ready", updatedAt: new Date() } });
    pushToUser(userId, "doc", { type: "completed", docId: String(_id), status: "ready" });
    return res.json({ ok: true, status: "ready" });
  }
  return res.json({ ok: false, status: doc.status || "processing", reason: "no_vectors" });
});

/** DELETE /documents/:id (soft by default; hard if ?hard=true) */
r.delete("/:id", ensureAuthed, async (req, res) => {
  const userId = req.auth()?.userId;
  const hard = String(req.query.hard || "false") === "true";
  const _id = new ObjectId(req.params.id);

  const col = (await db()).collection("documents");
  const doc = await col.findOne({ _id, ownerId: userId });
  if (!doc) return res.status(404).json({ error: "Not found" });

  if (!hard) {
    await col.updateOne(
      { _id, ownerId: userId },
      { $set: { deletedAt: new Date(), status: "deleted" } }
    );
    return res.json({ ok: true, mode: "soft" });
  }

  await col.updateOne(
    { _id, ownerId: userId },
    { $set: { status: "deleting", deletingAt: new Date() } }
  );

  await queue.add(
    "hard-delete",
    {
      docId: String(_id),
      ownerId: userId,
      gridId: String(doc.gridId),
      collection: doc.collection,
    },
    {
      removeOnComplete: 100,
      removeOnFail: 100,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
    }
  );

  res.json({ ok: true, mode: "hard", enqueued: true });
});

/** DELETE /documents (bulk) — hard by default; soft if ?hard=false) */
r.delete("/", ensureAuthed, async (req, res) => {
  const userId = req.auth()?.userId;
  const hard = String(req.query.hard || "true") === "true";
  const col = (await db()).collection("documents");

  if (!hard) {
    const r1 = await col.updateMany(
      { ownerId: userId, deletedAt: { $exists: false } },
      { $set: { deletedAt: new Date(), status: "deleted" } }
    );
    return res.json({
      ok: true, mode: "soft",
      matchedCount: r1.matchedCount, modifiedCount: r1.modifiedCount,
    });
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
        {
          docId: String(doc._id),
          ownerId: userId,
          gridId: String(doc.gridId),
          collection: doc.collection,
        },
        {
          removeOnComplete: 100,
          removeOnFail: 100,
          attempts: 3,
          backoff: { type: "exponential", delay: 2000 },
        }
      )
    )
  );

  res.json({ ok: true, mode: "hard", enqueued: docs.length, deletedCount: docs.length });
});

export default r;
