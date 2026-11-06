import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import './db.js';
import { publicRouter } from './routes/public.js';
import { authRouter, adminRouter } from './routes/admin.js';
import { webhookRouter } from './routes/webhook.js';
import { startScheduler } from './services/scheduler.js';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'img-src': ["'self'", 'data:', 'blob:'],
      'font-src': ["'self'", 'data:'],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'connect-src': ["'self'"],
      'frame-src': ["'self'", 'https://www.google.com', 'https://maps.google.com'],
      'upgrade-insecure-requests': config.production ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());

// Webhook needs the raw body for signature checks, so it goes before express.json.
app.use('/webhook/whatsapp', webhookRouter);
app.use(express.json({ limit: '12mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.use('/api/public', publicRouter);
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Web app (Vite build). Hashed assets cache for a year; index.html never.
if (fs.existsSync(config.webDist)) {
  app.use('/assets', express.static(path.join(config.webDist, 'assets'), { immutable: true, maxAge: '365d' }));
  app.use(express.static(config.webDist, { index: false, maxAge: '7d' }));
  const indexHtml = path.join(config.webDist, 'index.html');
  app.get(/^\/(?!api|webhook).*/, (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(indexHtml); });
} else {
  app.get('/', (_req, res) => res.type('text').send('Web build missing. Run "npm run build" in /web.'));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong on our side. Please try again.' : err.message, ...(err.extra || {}) });
});

app.listen(config.port, config.host, () => {
  console.log(`Anytime Dental running on http://localhost:${config.port}`);
  startScheduler(config.tickMs);
});
