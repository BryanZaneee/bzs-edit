import express from 'express';
import rateLimit from 'express-rate-limit';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { authRoutes, authenticate } from './auth.js';
import { contentRoutes } from './content.js';
import { uploadRoutes } from './upload.js';
import { EXT } from './media.js';

export { MAX_STRING, longestString } from './content.js';
export { slugify } from './fs.js';

// A site module is the only per-site surface. Everything else in src/ is shared.
function checkSite(site) {
  const problems = [];
  if (typeof site?.name !== 'string') problems.push('name must be a string');
  if (!Number.isInteger(site?.port)) problems.push('port must be an integer');
  if (typeof site?.uploadsUrl !== 'string') problems.push('uploadsUrl must be a string');
  if (site?.image?.kind === 'jpeg') {
    if (!(site.image.maxWidth > 0 && site.image.quality > 0)) problems.push('image.maxWidth and image.quality are required for kind "jpeg"');
  } else if (site?.image?.kind !== 'picture') problems.push('image.kind must be "picture" or "jpeg"');
  if (!Array.isArray(site?.files) || site.files.some(m => !(m in EXT))) problems.push(`files must list mimes from: ${Object.keys(EXT).join(', ')}`);
  if (!site?.content || typeof site.content !== 'object' || Object.values(site.content).some(v => typeof v !== 'function')) {
    problems.push('content must map file names to validator functions');
  }
  if (problems.length) throw new Error(`Invalid site module "${site?.name}": ${problems.join('; ')}`);
}

// Build the Express app for a site. Paths in `config` resolve relative to
// `configDir` (the directory holding config.json).
export function createServer(site, config, { configDir = process.cwd() } = {}) {
  checkSite(site);
  for (const k of ['jwtSecret', 'passwordHash', 'jwtExpiresIn']) {
    if (!config[k]) throw new Error(`config.${k} is missing — run the setup script first`);
  }
  const contentDir = resolve(configDir, config.contentDir ?? '../content');
  const uploadsDir = config.uploadsDir ? resolve(configDir, config.uploadsDir) : join(contentDir, 'uploads');
  const backupsDir = config.backupsDir ? resolve(configDir, config.backupsDir) : join(contentDir, '.backups');
  for (const dir of [uploadsDir, backupsDir]) mkdirSync(dir, { recursive: true });

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.set('trust proxy', 1);
  app.use('/api/', rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: { error: 'Too many requests. Slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
  }));

  const auth = authenticate(config);
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', site: site.name }));
  authRoutes(app, config);
  contentRoutes(app, auth, site, { contentDir, backupsDir, maxBackups: config.maxBackups ?? 20 });
  uploadRoutes(app, auth, site, { uploadsDir, maxFileSizeMB: config.maxFileSizeMB ?? 100 });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error('Unhandled error:', err);
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
  });
  return app;
}

// Read config.json, listen on loopback, drain on SIGTERM. This is the whole of
// a site's api/server.js: `start(site, join(import.meta.dirname, 'config.json'))`.
export async function start(site, configPath = process.env.CONFIG_PATH || join(process.cwd(), 'config.json')) {
  let config;
  try {
    config = JSON.parse(await readFile(configPath, 'utf-8'));
  } catch {
    console.error(`Failed to read ${configPath} — run \`npx bzs-edit-setup <password>\` first`);
    process.exit(1);
  }
  const app = createServer(site, config, { configDir: dirname(resolve(configPath)) });
  const port = Number(process.env.PORT) || site.port;
  // Loopback only — Caddy (prod) / Vite (dev) proxy /api to it.
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`${site.name} admin API running on http://127.0.0.1:${port}`);
  });
  server.on('error', err => {
    console.error('Server error:', err);
    process.exit(1);
  });
  // close() drains in-flight requests so `systemctl restart` mid-publish can't
  // truncate a content file (together with writeAtomic).
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
  return server;
}
