// Site-agnostic behaviour: auth, the content whitelist, atomic writes and
// backups, and the parts of upload every site shares. Runs against a tiny
// fixture site so nothing here depends on a real site's schema.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import { createServer } from '../src/server.js';
import { jpeg, mp4, PASSWORD, png, startSite } from './helpers.js';

const isObject = b => (b && typeof b === 'object' && !Array.isArray(b) ? null : 'must be an object');
const fixture = {
  name: 'fixture',
  port: 3999,
  uploadsUrl: '/content/uploads',
  image: { kind: 'picture' },
  files: ['image/svg+xml', 'image/png', 'image/jpeg', 'video/mp4'],
  content: { 'site.json': isObject, 'extra.json': b => (Array.isArray(b) ? null : 'must be a list') },
};

let s;
before(async () => { s = await startSite(fixture, { seed: { 'site.json': { title: 'seed' }, 'extra.json': [] } }); });
after(() => s.stop());

describe('site module contract', () => {
  it('rejects a malformed site module up front', () => {
    const cfg = { jwtSecret: 'x', passwordHash: 'y', jwtExpiresIn: '1h' };
    assert.throws(() => createServer({ ...fixture, image: { kind: 'bmp' } }, cfg), /image\.kind/);
    assert.throws(() => createServer({ ...fixture, files: ['text/html'] }, cfg), /files must list/);
    assert.throws(() => createServer({ ...fixture, content: { 'a.json': 'nope' } }, cfg), /validator functions/);
    assert.throws(() => createServer(fixture, { jwtSecret: 'x' }), /passwordHash/);
  });
});

describe('auth', () => {
  it('rejects a wrong password, a missing one, and an over-long one', async () => {
    assert.equal((await s.api('/api/auth/login', { method: 'POST', body: { password: 'nope' }, auth: false })).status, 401);
    assert.equal((await s.api('/api/auth/login', { method: 'POST', body: {}, auth: false })).status, 400);
    assert.equal((await s.api('/api/auth/login', { method: 'POST', body: { password: 'a'.repeat(129) }, auth: false })).status, 400);
  });
  it('refuses unauthenticated, malformed, expired and alg-none tokens', async () => {
    assert.equal((await s.api('/api/content/site.json', { auth: false })).status, 401);
    s.setToken('not-a-jwt');
    assert.equal((await s.api('/api/content/site.json')).status, 401);
    s.setToken(jwt.sign({ role: 'admin' }, s.config.jwtSecret, { expiresIn: -10 }));
    const expired = await s.api('/api/content/site.json');
    assert.equal(expired.status, 401);
    assert.match(expired.body.error, /expired/i);
    s.setToken(jwt.sign({ role: 'admin' }, '', { algorithm: 'none' }));
    assert.equal((await s.api('/api/content/site.json')).status, 401);
    s.setToken(null);
  });
  it('issues a token that verifies', async () => {
    assert.equal((await s.login()).status, 200);
    assert.equal((await s.api('/api/auth/verify')).status, 200);
  });
  it('health is public and names the site', async () => {
    const res = await s.api('/api/health', { auth: false });
    assert.equal(res.status, 200);
    assert.equal(res.body.site, 'fixture');
  });
});

describe('content', () => {
  it('reads every declared file and nothing else', async () => {
    assert.equal((await s.api('/api/content/site.json')).body.title, 'seed');
    assert.deepEqual((await s.api('/api/content/extra.json')).body, []);
    for (const p of ['other.json', 'config.json', '..%2Fconfig.json', 'site.json%00', 'SITE.JSON']) {
      assert.equal((await s.api(`/api/content/${p}`)).status, 404, p);
      assert.equal((await s.api(`/api/content/${p}`, { method: 'PUT', body: {} })).status, 404, p);
    }
  });
  it('runs the site validator and returns its message', async () => {
    const res = await s.api('/api/content/extra.json', { method: 'PUT', body: { not: 'a list' } });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'must be a list');
    assert.equal((await s.api('/api/content/site.json', { method: 'PUT', body: [] })).status, 400);
    assert.equal((await s.api('/api/content/site.json', { method: 'PUT', body: null })).status, 400);
  });
  it('turns malformed or oversized JSON into 400/413, never 500', async () => {
    assert.equal((await s.api('/api/content/site.json', { method: 'PUT', raw: '{bad json' })).status, 400);
    assert.equal((await s.api('/api/content/site.json', { method: 'PUT', body: { big: 'x'.repeat(1_100_000) } })).status, 413);
  });
  it('writes atomically with a pruned backup trail', async () => {
    for (const title of ['A', 'B', 'C']) {
      assert.equal((await s.api('/api/content/site.json', { method: 'PUT', body: { title } })).status, 200);
    }
    assert.equal((await s.api('/api/content/site.json')).body.title, 'C');
    const backups = (await readdir(join(s.contentDir, '.backups'))).filter(f => f.endsWith('.json'));
    assert.equal(backups.length, 2); // maxBackups
    assert.ok(backups.every(f => f.startsWith('site_')));
    assert.equal((await readdir(s.contentDir)).filter(f => f.endsWith('.tmp')).length, 0);
    assert.equal(JSON.parse(await readFile(join(s.contentDir, 'site.json'), 'utf-8')).title, 'C');
  });
  it('answers unknown /api paths with JSON 404', async () => {
    const res = await s.api('/api/nope');
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: 'Not found' });
  });
});

describe('upload', () => {
  it('needs auth, a file and a kind', async () => {
    s.setToken(null);
    assert.equal((await s.upload('image', await jpeg(), 'image/jpeg')).status, 401);
    await s.login();
    const fd = new FormData();
    fd.append('kind', 'image');
    assert.equal((await s.api('/api/upload', { method: 'POST', body: fd })).status, 400);
    assert.equal((await s.upload(undefined, await jpeg(), 'image/jpeg')).status, 400);
    assert.equal((await s.upload('bogus', await jpeg(), 'image/jpeg')).status, 400);
  });
  it('names files from the original name only through slugify + a fixed extension', async () => {
    const res = await s.upload('file', mp4(), 'video/mp4', '../../etc/My Clip!.mp4');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.match(res.body.url, /^\/content\/uploads\/my-clip-[a-z0-9]+\.mp4$/);
    const files = await readdir(s.uploadsDir);
    assert.equal(files.length, 1);
    assert.equal(files[0], res.body.url.replace('/content/uploads/', ''));
    assert.match((await s.upload('file', mp4(), 'video/mp4', '???.mp4')).body.url, /\/upload-[a-z0-9]+\.mp4$/);
  });
  it('does not trust the client mimetype', async () => {
    for (const [bytes, type] of [
      ['<html><script>1</script></html>', 'image/svg+xml'],
      ['<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>', 'image/svg+xml'],
      ['<svg xmlns="http://www.w3.org/2000/svg" onload="1"/>', 'image/svg+xml'],
      ['<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:1"/></svg>', 'image/svg+xml'],
      ['not a png', 'image/png'],
      ['not a jpeg', 'image/jpeg'],
      ['not a video', 'video/mp4'],
    ]) {
      assert.equal((await s.upload('file', bytes, type)).status, 400, `${type}: ${bytes}`);
    }
    assert.equal((await s.upload('file', 'x', 'text/html', 'evil.html')).status, 400);
    assert.equal((await s.upload('file', mp4(), 'video/quicktime', 'x.mov')).status, 400); // not in this site's list
    assert.equal((await s.upload('image', 'garbage', 'image/jpeg')).status, 400); // sharp can't decode it
    assert.equal((await s.upload('image', '<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml')).status, 400); // svg is not a photo
    assert.equal((await readdir(s.uploadsDir)).filter(f => f.endsWith('.tmp')).length, 0);
  });
  it('accepts a clean SVG and shrinks raster files sent as kind=file', async () => {
    const svg = await s.upload('file', '<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml', 'logo.svg');
    assert.equal(svg.status, 200);
    assert.match(svg.body.url, /^\/content\/uploads\/logo-\w+\.svg$/);
    const res = await s.upload('file', await png(), 'image/png', 'poster.png');
    assert.equal(res.status, 200);
    const sharp = (await import('sharp')).default;
    const { width } = await sharp(join(s.uploadsDir, res.body.url.replace('/content/uploads/', ''))).metadata();
    assert.equal(width, 2000);
  });
  it('enforces the size cap with a readable message', async () => {
    const res = await s.upload('file', Buffer.alloc(1.5 * 1024 * 1024), 'video/mp4', 'big.mp4');
    assert.equal(res.status, 400);
    assert.match(res.body.error, /too big/);
  });
});

describe('rate limiting', () => {
  it('locks the login route after 5 attempts in a minute', async () => {
    const t = await startSite(fixture);
    try {
      let last;
      for (let i = 0; i < 6; i++) last = await t.api('/api/auth/login', { method: 'POST', body: { password: PASSWORD }, auth: false });
      assert.equal(last.status, 429);
    } finally {
      await t.stop();
    }
  });
});
