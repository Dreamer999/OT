import { Router } from 'express';
import multer from 'multer';

// The PWA manifest's share_target posts to this URL.
// We can't auth this (it's triggered by the OS share sheet) — instead we hand off
// to the SPA, which already holds the bearer token in localStorage, so it can
// re-POST the received file to /api/recordings with auth.
//
// Strategy: buffer the file in memory, store it behind a short-lived id,
// and redirect the browser to /#share=<id> where the SPA picks it up.

const shares = new Map();
const TTL_MS = 60_000;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

export const shareRouter = Router();

shareRouter.post('/', upload.any(), (req, res) => {
  const file = (req.files || []).find((f) => f.fieldname === 'audio') || (req.files || [])[0];
  if (!file) return res.redirect('/?share_error=no_file');
  const id = Math.random().toString(36).slice(2, 12);
  shares.set(id, { file, expires: Date.now() + TTL_MS });
  res.redirect(`/#share=${id}`);
});

shareRouter.get('/:id', (req, res) => {
  const entry = shares.get(req.params.id);
  if (!entry || entry.expires < Date.now()) {
    shares.delete(req.params.id);
    return res.status(404).end();
  }
  shares.delete(req.params.id);
  res.set('Content-Type', entry.file.mimetype || 'application/octet-stream');
  res.set('X-Filename', entry.file.originalname || 'shared');
  res.send(entry.file.buffer);
});

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of shares) if (v.expires < now) shares.delete(k);
}, 30_000).unref();
