import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });

// Stable signing secret: env first, otherwise generated once and kept on disk.
function secret() {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  const f = path.join(dataDir, '.secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(f, 'utf8').trim();
}

export const config = {
  port: Number(process.env.PORT || 9822),
  host: process.env.HOST || '0.0.0.0',
  dataDir,
  dbPath: path.join(dataDir, 'anytime.db'),
  webDist: path.resolve(root, '..', 'web', 'dist'),
  secret: secret(),
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  production: process.env.NODE_ENV === 'production',
  tickMs: Number(process.env.TICK_MS || 30000),
};
