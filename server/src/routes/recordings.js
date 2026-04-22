import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { db } from '../db.js';
import { config } from '../config.js';
import { authMiddleware } from '../auth.js';
import { enqueue } from '../worker.js';
import { addClient } from '../events.js';

export const recordingsRouter = Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.audioDir),
  filename: (_req, _file, cb) => cb(null, nanoid()),
});
const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadBytes },
});

recordingsRouter.post('/', authMiddleware, upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'audio file required (field name "audio")' });
  const id = req.file.filename;
  const now = Date.now();
  db.prepare(`INSERT INTO recordings
    (id, user_id, filename, mime, bytes, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`).run(
    id, req.userId, req.file.originalname, req.file.mimetype, req.file.size, now, now
  );
  enqueue(id);
  res.status(202).json({ id, status: 'queued' });
});

recordingsRouter.get('/', authMiddleware, (req, res) => {
  const q = (req.query.q || '').toString().trim();
  let rows;
  if (q) {
    rows = db.prepare(`
      SELECT r.* FROM recordings r
      JOIN transcripts_fts f ON f.recording_id = r.id
      WHERE r.user_id = ? AND r.deleted_at IS NULL AND transcripts_fts MATCH ?
      ORDER BY r.created_at DESC LIMIT 200
    `).all(req.userId, q);
  } else {
    rows = db.prepare(`
      SELECT * FROM recordings
      WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT 200
    `).all(req.userId);
  }
  res.json({ recordings: rows });
});

recordingsRouter.get('/events', authMiddleware, (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders?.();
  res.write(`retry: 3000\n\n`);
  addClient(res);
});

recordingsRouter.get('/:id', authMiddleware, (req, res) => {
  const rec = db.prepare('SELECT * FROM recordings WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId);
  if (!rec || rec.deleted_at) return res.status(404).json({ error: 'not found' });
  const transcript = db.prepare('SELECT text, language, provider FROM transcripts WHERE recording_id = ?')
    .get(rec.id);
  const analysisRow = db.prepare(`SELECT summary, action_items_json, decisions_json, topics_json, sentiment, provider
    FROM analyses WHERE recording_id = ?`).get(rec.id);
  const analysis = analysisRow ? {
    summary: analysisRow.summary,
    action_items: JSON.parse(analysisRow.action_items_json || '[]'),
    decisions: JSON.parse(analysisRow.decisions_json || '[]'),
    topics: JSON.parse(analysisRow.topics_json || '[]'),
    sentiment: analysisRow.sentiment,
    provider: analysisRow.provider,
  } : null;
  res.json({ recording: rec, transcript: transcript || null, analysis });
});

recordingsRouter.get('/:id/audio', authMiddleware, (req, res) => {
  const rec = db.prepare('SELECT id, mime FROM recordings WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId);
  if (!rec) return res.status(404).end();
  const file = path.join(config.audioDir, rec.id);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.set('Content-Type', rec.mime || 'audio/mpeg');
  fs.createReadStream(file).pipe(res);
});

recordingsRouter.delete('/:id', authMiddleware, (req, res) => {
  const info = db.prepare('UPDATE recordings SET deleted_at = ? WHERE id = ? AND user_id = ?')
    .run(Date.now(), req.params.id, req.userId);
  if (info.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});
