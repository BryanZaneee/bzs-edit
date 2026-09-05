import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { backupFile, writeAtomic } from './fs.js';

// GET/PUT /api/content/:file for exactly the files the site module declares.
// The whitelist is an exact-match lookup, so a traversal segment can never name a
// file; the validator is the site's shape check that stops a broken publish
// from blanking the public page.
export function contentRoutes(app, auth, site, { contentDir, backupsDir, maxBackups }) {
  const validators = site.content;
  const pathFor = file => (Object.hasOwn(validators, file) ? join(contentDir, file) : null);

  app.get('/api/content/:file', auth, async (req, res) => {
    const filePath = pathFor(req.params.file);
    if (!filePath) return res.status(404).json({ error: 'Not found' });
    try {
      res.json(JSON.parse(await readFile(filePath, 'utf-8')));
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'Content file not found' });
      res.status(500).json({ error: 'Failed to read content' });
    }
  });

  app.put('/api/content/:file', auth, async (req, res) => {
    const filePath = pathFor(req.params.file);
    if (!filePath) return res.status(404).json({ error: 'Not found' });
    if (req.body === undefined || req.body === null) return res.status(400).json({ error: 'Request body is required' });
    const error = validators[req.params.file](req.body);
    if (error) return res.status(400).json({ error });
    try {
      await backupFile(filePath, backupsDir, maxBackups);
      await writeAtomic(filePath, JSON.stringify(req.body, null, 2));
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Failed to write content' });
    }
  });
}

// Shared backstop for validators: the longest string anywhere in a value.
// Per-field character caps live in each site's editor; this catches a bypass.
export const MAX_STRING = 1000;
export function longestString(v) {
  if (typeof v === 'string') return v.length;
  if (v && typeof v === 'object') return Math.max(0, ...Object.values(v).map(longestString));
  return 0;
}
