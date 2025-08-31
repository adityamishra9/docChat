// server/queue/handlers.js
import { ObjectId } from "mongodb";
import { db } from "../db/mongo.js";
import { queueEvents } from "./bull.js";
import { pushToUser } from "../realtime/sse.js";

function toObjId(id) {
  try { return new ObjectId(id); } catch { return null; }
}

// progress
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
    console.error("progress persist error:", e);
  }
  pushToUser(ownerId, "doc", {
    type: "progress", docId, status: status || "processing",
    pct: typeof pct === "number" ? pct : null, stage: stage ?? null,
  });
});

// completed
queueEvents.on("completed", async ({ returnvalue }) => {
  const { ownerId, docId, pages } = returnvalue || {};
  if (!ownerId || !docId) return;
  try {
    const col = (await db()).collection("documents");
    await col.updateOne(
      { _id: toObjId(docId), ownerId },
      { $set: { status: "ready", updatedAt: new Date() } }
    );
  } catch (e) {
    console.error("completed persist error:", e);
  }
  pushToUser(ownerId, "doc", { type: "completed", docId, status: "ready", pages });
});

// failed
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
    console.error("failed persist error:", e);
  }
  pushToUser(ownerId, "doc", { type: "failed", docId, status: "error", error: failedReason || null });
});
