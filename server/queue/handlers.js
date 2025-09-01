// server/queue/handlers.js
import { ObjectId } from "mongodb";
import { db } from "../db/mongo.js";
import { queueEvents } from "./bull.js";
import { pushToUser } from "../realtime/sse.js";

function toObjId(id) {
  try { return new ObjectId(id); } catch { return null; }
}

function parseReturnValue(rv) {
  if (!rv) return {};
  if (typeof rv === "string") {
    try { return JSON.parse(rv); } catch { return {}; }
  }
  return rv;
}

// progress (keeps UI responsive, idempotent)
queueEvents.on("progress", async ({ data }) => {
  const { ownerId, docId, pct, stage, status } = data || {};
  if (!ownerId || !docId) return;
  try {
    const col = (await db()).collection("documents");
    await col.updateOne(
      { _id: toObjId(docId), ownerId },
      {
        $set: {
          status: status || "processing",
          updatedAt: new Date(),
          progress: typeof pct === "number" ? pct : undefined,
          stage: stage || undefined,
        },
      }
    );
  } catch (e) {
    console.error("progress persist error:", e?.message || e);
  }
  pushToUser(ownerId, "doc", {
    type: "progress",
    docId,
    status: status || "processing",
    pct: typeof pct === "number" ? pct : null,
    stage: stage ?? null,
  });
});

// completed (authoritative flip → ready)
queueEvents.on("completed", async (payload) => {
  const ret = parseReturnValue(payload?.returnvalue);
  const { ownerId, docId, pages } = ret || {};
  if (!ownerId || !docId) return;

  try {
    const col = (await db()).collection("documents");
    await col.updateOne(
      { _id: toObjId(docId), ownerId },
      { $set: { status: "ready", updatedAt: new Date(), pages: pages ?? undefined } }
    );
  } catch (e) {
    console.error("completed persist error:", e?.message || e);
  }

  pushToUser(ownerId, "doc", { type: "completed", docId, status: "ready", pages: pages ?? null });
});

// failed (authoritative flip → error)
queueEvents.on("failed", async ({ failedReason, data }) => {
  const { ownerId, docId } = data || {};
  if (!ownerId || !docId) return;
  try {
    const col = (await db()).collection("documents");
    await col.updateOne(
      { _id: toObjId(docId), ownerId },
      {
        $set: {
          status: "error",
          error: failedReason || "Unknown",
          updatedAt: new Date(),
        },
      }
    );
  } catch (e) {
    console.error("failed persist error:", e?.message || e);
  }
  pushToUser(ownerId, "doc", { type: "failed", docId, status: "error", error: failedReason || null });
});