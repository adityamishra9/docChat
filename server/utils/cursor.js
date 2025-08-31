// server/utils/cursor.js
export function makeCursor(doc) {
  const ts =
    doc.createdAt?.toISOString?.() || doc.createdAt || new Date().toISOString();
  return `${ts}_${String(doc._id)}`;
}
export function parseCursor(cursor) {
  const idx = cursor.lastIndexOf("_");
  if (idx === -1) return null;
  const createdAtIso = cursor.slice(0, idx);
  const id = cursor.slice(idx + 1);
  const d = new Date(createdAtIso);
  if (isNaN(d.getTime())) return null;
  return { createdAt: d, id };
}
