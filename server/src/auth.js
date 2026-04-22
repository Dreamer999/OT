import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import fs from 'node:fs';
import { db } from './db.js';
import { config } from './config.js';

const now = () => Date.now();

export async function bootstrapDemoUser() {
  const existing = db.prepare('SELECT id FROM users LIMIT 1').get();
  if (existing) return;

  const userId = nanoid();
  db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run(
    userId,
    'demo@local',
    now()
  );

  const raw = `ot_${nanoid(40)}`;
  const hash = await argon2.hash(raw);
  db.prepare('INSERT INTO tokens (id, user_id, hash, name, created_at) VALUES (?, ?, ?, ?, ?)').run(
    nanoid(),
    userId,
    hash,
    'bootstrap',
    now()
  );

  fs.writeFileSync(config.initialTokenFile, raw + '\n', { mode: 0o600 });

  // eslint-disable-next-line no-console
  console.log('\n' + '='.repeat(64));
  console.log('  OT bootstrap token (paste in Settings → Save):');
  console.log('    ' + raw);
  console.log('  (also written to ' + config.initialTokenFile + ')');
  console.log('='.repeat(64) + '\n');
}

export async function authMiddleware(req, res, next) {
  const hdr = req.get('authorization') || '';
  const m = hdr.match(/^Bearer\s+(\S+)/i);
  if (!m) return res.status(401).json({ error: 'missing bearer token' });
  const presented = m[1];

  const tokens = db.prepare('SELECT id, user_id, hash FROM tokens').all();
  for (const t of tokens) {
    // eslint-disable-next-line no-await-in-loop
    if (await argon2.verify(t.hash, presented)) {
      db.prepare('UPDATE tokens SET last_used_at = ? WHERE id = ?').run(now(), t.id);
      req.userId = t.user_id;
      return next();
    }
  }
  return res.status(401).json({ error: 'invalid token' });
}
