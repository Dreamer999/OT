import express from 'express';
import pinoHttp from 'pino-http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { db } from './db.js';
import { bootstrapDemoUser } from './auth.js';
import { recordingsRouter } from './routes/recordings.js';
import { dashboardRouter } from './routes/dashboard.js';
import { shareRouter } from './routes/share.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../../public');

const app = express();
app.use(pinoHttp());
app.disable('x-powered-by');

app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/readyz', (_req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.use('/api/recordings', recordingsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/share', shareRouter);

app.use(express.static(publicDir, { extensions: ['html'] }));
app.get(/^(?!\/api|\/share|\/healthz|\/readyz).*/, (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

await bootstrapDemoUser();

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`OT listening on http://localhost:${config.port}  (env=${config.env})`);
  console.log(`  transcription: ${config.transcription.provider}`);
  console.log(`  analysis:      ${config.analysis.provider}`);
});
