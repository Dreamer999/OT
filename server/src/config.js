import 'dotenv/config';
import path from 'node:path';

const dataDir = path.resolve(process.env.DATA_DIR || './data');

export const config = {
  port: Number(process.env.PORT) || 3000,
  env: process.env.NODE_ENV || 'development',
  dataDir,
  audioDir: path.join(dataDir, 'audio'),
  dbFile: path.join(dataDir, 'ot.sqlite'),
  initialTokenFile: path.join(dataDir, 'initial-token.txt'),
  maxUploadBytes: (Number(process.env.MAX_UPLOAD_MB) || 500) * 1024 * 1024,
  transcription: {
    provider: (process.env.TRANSCRIPTION_PROVIDER || 'mock').toLowerCase(),
    openaiKey: process.env.OPENAI_API_KEY || '',
  },
  analysis: {
    provider: (process.env.ANALYSIS_PROVIDER || 'mock').toLowerCase(),
    anthropicKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
  },
};
