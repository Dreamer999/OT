import path from 'node:path';
import { db } from './db.js';
import { config } from './config.js';
import { getTranscriptionProvider } from './providers/transcription.js';
import { getAnalysisProvider } from './providers/analysis.js';
import { emit } from './events.js';

const queue = [];
let draining = false;

export function enqueue(recordingId) {
  queue.push(recordingId);
  drain();
}

async function drain() {
  if (draining) return;
  draining = true;
  while (queue.length) {
    const id = queue.shift();
    try {
      await processOne(id);
    } catch (err) {
      const msg = err?.message || String(err);
      db.prepare('UPDATE recordings SET status = ?, error = ?, updated_at = ? WHERE id = ?').run(
        'failed', msg, Date.now(), id
      );
      emit(id, { status: 'failed', error: msg });
    }
  }
  draining = false;
}

async function processOne(id) {
  const rec = db.prepare('SELECT * FROM recordings WHERE id = ?').get(id);
  if (!rec) return;

  db.prepare('UPDATE recordings SET status = ?, updated_at = ? WHERE id = ?').run(
    'transcribing', Date.now(), id
  );
  emit(id, { status: 'transcribing' });

  const absPath = path.join(config.audioDir, id);
  const tx = getTranscriptionProvider();
  const t = await tx.transcribe({ absPath, filename: rec.filename });

  db.prepare(`INSERT OR REPLACE INTO transcripts (recording_id, text, language, provider, raw_json)
              VALUES (?, ?, ?, ?, ?)`).run(
    id, t.text, t.language || null, tx.name, JSON.stringify(t.raw || {})
  );
  db.prepare(`INSERT INTO transcripts_fts (text, recording_id) VALUES (?, ?)`).run(t.text, id);
  db.prepare('UPDATE recordings SET status = ?, updated_at = ? WHERE id = ?').run(
    'transcribed', Date.now(), id
  );
  emit(id, { status: 'transcribed' });

  db.prepare('UPDATE recordings SET status = ?, updated_at = ? WHERE id = ?').run(
    'analyzing', Date.now(), id
  );
  emit(id, { status: 'analyzing' });

  const an = getAnalysisProvider();
  const a = await an.analyze({ text: t.text });

  db.prepare(`INSERT OR REPLACE INTO analyses
    (recording_id, summary, action_items_json, decisions_json, topics_json, sentiment, provider, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id,
    a.summary || '',
    JSON.stringify(a.action_items || []),
    JSON.stringify(a.decisions || []),
    JSON.stringify(a.topics || []),
    a.sentiment || 'neutral',
    an.name,
    JSON.stringify(a.raw || {})
  );

  db.prepare('UPDATE recordings SET status = ?, updated_at = ? WHERE id = ?').run(
    'analyzed', Date.now(), id
  );
  emit(id, { status: 'analyzed' });
}
