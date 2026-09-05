// In-process test harness: one server per site on a random loopback port with
// a throwaway config + content dir. No child processes, no test framework.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import sharp from 'sharp';
import { createServer } from '../src/server.js';

export const PASSWORD = 'test-password';
export const jpeg = (width = 700, height = 500) =>
  sharp({ create: { width, height, channels: 3, background: '#c8a94e' } }).jpeg().toBuffer();
export const png = (width = 2500, height = 100) =>
  sharp({ create: { width, height, channels: 4, background: '#0000' } }).png().toBuffer();
export const mp4 = (brand = 'isom') => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftyp' + brand), Buffer.alloc(64)]);

export async function startSite(site, { seed = {}, config = {} } = {}) {
  const tmp = join(import.meta.dirname, '.test-tmp', `${site.name}-${randomBytes(4).toString('hex')}`);
  const contentDir = join(tmp, 'content');
  await rm(tmp, { recursive: true, force: true });
  await mkdir(contentDir, { recursive: true });
  for (const [file, body] of Object.entries(seed)) await writeFile(join(contentDir, file), JSON.stringify(body));

  const cfg = {
    contentDir,
    maxBackups: 2,
    maxFileSizeMB: 1,
    jwtExpiresIn: '1h',
    jwtSecret: randomBytes(32).toString('hex'),
    passwordHash: await bcrypt.hash(PASSWORD, 4),
    ...config,
  };
  const app = createServer(site, cfg, { configDir: tmp });
  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const uploadsDir = cfg.uploadsDir ? join(tmp, cfg.uploadsDir) : join(contentDir, 'uploads');
  let token = null;

  async function api(path, { method = 'GET', body, headers = {}, auth = true, raw } = {}) {
    if (auth && token) headers.Authorization = `Bearer ${token}`;
    if (raw !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = raw;
    } else if (body && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const res = await fetch(base + path, { method, body, headers });
    return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
  }
  async function login() {
    const res = await api('/api/auth/login', { method: 'POST', body: { password: PASSWORD }, auth: false });
    token = res.body?.token ?? null;
    return res;
  }
  function upload(kind, bytes, type, name = 'x') {
    const fd = new FormData();
    if (kind) fd.append('kind', kind);
    fd.append('file', new Blob([bytes], { type }), name);
    return api('/api/upload', { method: 'POST', body: fd });
  }
  async function stop() {
    await new Promise(resolve => server.close(resolve));
    await rm(tmp, { recursive: true, force: true });
  }
  return { api, login, upload, stop, tmp, contentDir, uploadsDir, config: cfg, setToken: t => { token = t; } };
}
