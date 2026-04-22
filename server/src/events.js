const clients = new Set();

export function addClient(res) {
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

export function emit(recordingId, payload) {
  const data = `data: ${JSON.stringify({ recordingId, ...payload, ts: Date.now() })}\n\n`;
  for (const res of clients) {
    try { res.write(data); } catch { /* ignore */ }
  }
}
