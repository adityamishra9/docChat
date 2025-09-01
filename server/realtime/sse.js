// server/realtime/sse.js
/** Map<userId, Set<res>> */
const clients = new Map();

export function sseHandler(req, res, userId) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);

  res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  const ping = setInterval(() => res.write(`: ping\n\n`), 15000);

  req.on("close", () => {
    clearInterval(ping);
    const set = clients.get(userId);
    if (set) {
      set.delete(res);
      if (set.size === 0) clients.delete(userId);
    }
    res.end();
  });
}

export function pushToUser(userId, event, data) {
  const set = clients.get(userId);
  if (!set || set.size === 0) return;
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) res.write(line);
}