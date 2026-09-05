// Esmé Belle: two content files, single-JPEG photos in assets/images, raw
// GIF/MP4/MOV for artwork videos.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import site from '../sites/esme.js';
import { jpeg, mp4, png, startSite } from './helpers.js';

const artworks = () => [
  { id: 'a', title: 'A', type: 'painting', year: 2025, medium: 'oil', size: '10x10', images: ['assets/images/a.jpg'], order: 0 },
  { id: 'b', title: 'B', type: 'drawing', year: 2024, medium: 'ink', size: '', images: ['assets/images/b.jpg'], video: 'assets/images/b.mp4', order: 1 },
];
const siteJson = () => ({
  bio: { sections: ['Hello'] },
  social: [{ platform: 'Instagram', url: 'https://instagram.com/x', handle: '@x' }],
  categories: { labels: { painting: 'Paintings', drawing: 'Drawings' }, order: ['painting', 'drawing'] },
  years: [2025, 2024],
});

let s;
before(async () => {
  s = await startSite(site, {
    seed: { 'artworks.json': artworks(), 'site.json': siteJson() },
    config: { uploadsDir: 'assets/images', backupsDir: 'content/.backups' },
  });
  await s.login();
});
after(() => s.stop());

describe('esme content', () => {
  it('serves both files', async () => {
    assert.equal((await s.api('/api/content/artworks.json')).body.length, 2);
    assert.equal((await s.api('/api/content/site.json')).body.years[0], 2025);
  });
  it('validates artworks.json', async () => {
    const put = async mutate => {
      const next = artworks();
      mutate(next);
      return s.api('/api/content/artworks.json', { method: 'PUT', body: next });
    };
    assert.equal((await put(a => a.push({ ...a[0], id: 'c', video: 'assets/images/c.mp4', order: 2 }))).status, 200);
    assert.equal((await s.api('/api/content/artworks.json', { method: 'PUT', body: { not: 'a list' } })).status, 400);
    assert.equal((await put(a => delete a[0].id)).status, 400);
    assert.equal((await put(a => (a[0].title = ''))).status, 400);
    assert.equal((await put(a => (a[0].type = 5))).status, 400);
    assert.equal((await put(a => (a[0].year = '2025'))).status, 400);
    assert.equal((await put(a => (a[0].images = 'x.jpg'))).status, 400);
    assert.equal((await put(a => (a[0].images = [1]))).status, 400);
    assert.equal((await put(a => (a[1].video = 123))).status, 400);
    assert.equal((await put(a => (a[1].order = '1'))).status, 400);
    assert.equal((await put(a => (a[0].title = 'a'.repeat(1001)))).status, 400);
    assert.equal((await put(a => a.push(null))).status, 400);
  });
  it('validates site.json', async () => {
    const put = async mutate => {
      const next = siteJson();
      mutate(next);
      return (await s.api('/api/content/site.json', { method: 'PUT', body: next })).status;
    };
    assert.equal(await put(() => {}), 200);
    assert.equal(await put(x => delete x.bio), 400);
    assert.equal(await put(x => (x.social = {})), 400);
    assert.equal(await put(x => x.social.push({ platform: 'x', url: 'javascript:alert(1)' })), 400);
    assert.equal(await put(x => x.social.push({ platform: 'Mail', url: 'mailto:a@b.c' })), 200);
    assert.equal(await put(x => delete x.categories.labels), 400);
    assert.equal(await put(x => (x.years = ['2025'])), 400);
    assert.equal(await put(x => (x.bio.sections[0] = 'a'.repeat(1001))), 400);
  });
  it('keeps backups per file', async () => {
    for (const t of ['A2', 'A3', 'A4']) {
      const next = artworks();
      next[0].title = t;
      assert.equal((await s.api('/api/content/artworks.json', { method: 'PUT', body: next })).status, 200);
    }
    const backups = await readdir(join(s.contentDir, '.backups'));
    assert.equal(backups.filter(f => f.startsWith('artworks_')).length, 2);
    assert.ok(backups.some(f => f.startsWith('site_')));
  });
});

describe('esme upload', () => {
  it('kind=image → one downscaled JPEG in assets/images, url without a leading slash', async () => {
    const res = await s.upload('image', await jpeg(3000, 200), 'image/jpeg', 'Girl and Panaag.jpg');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.match(res.body.url, /^assets\/images\/girl-and-panaag-[a-z0-9]+\.jpg$/);
    assert.equal(res.body.picture, undefined);
    const file = join(s.uploadsDir, res.body.url.replace('assets/images/', ''));
    const meta = await sharp(file).metadata();
    assert.equal(meta.format, 'jpeg');
    assert.equal(meta.width, 2400);
    assert.equal((await readdir(s.uploadsDir)).length, 1); // no srcset variants
  });
  it('converts PNG and WebP photos to JPEG and leaves small ones unscaled', async () => {
    const res = await s.upload('image', await png(300, 200), 'image/png', 'small.png');
    assert.equal(res.status, 200);
    assert.match(res.body.url, /\.jpg$/);
    const { width } = await sharp(join(s.uploadsDir, res.body.url.replace('assets/images/', ''))).metadata();
    assert.equal(width, 300);
  });
  it('kind=file accepts gif, mp4 and mov and sniffs their bytes', async () => {
    const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(32)]);
    assert.match((await s.upload('file', gif, 'image/gif', 'anim.gif')).body.url, /^assets\/images\/anim-\w+\.gif$/);
    assert.match((await s.upload('file', mp4(), 'video/mp4', 'clip.mp4')).body.url, /\.mp4$/);
    assert.match((await s.upload('file', mp4('qt  '), 'video/quicktime', 'clip.mov')).body.url, /\.mov$/);
    for (const [bytes, type] of [['not a gif', 'image/gif'], ['not a video', 'video/mp4'], ['nope', 'video/quicktime']]) {
      assert.equal((await s.upload('file', bytes, type)).status, 400, type);
    }
    assert.equal((await s.upload('file', await png(), 'image/png', 'x.png')).status, 400); // png only as a photo here
    assert.equal((await s.upload('image', gif, 'image/gif', 'anim.gif')).status, 400); // gif is not a photo
    assert.equal((await s.upload('file', '<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml', 'x.svg')).status, 400);
  });
  it('leaves no temp file behind when sharp rejects the bytes', async () => {
    assert.equal((await s.upload('image', 'not really a jpeg', 'image/jpeg', 'bad.jpg')).status, 400);
    const files = await readdir(s.uploadsDir);
    assert.equal(files.filter(f => f.endsWith('.tmp') || f.startsWith('bad-')).length, 0);
    assert.equal((await readFile(join(s.contentDir, 'artworks.json'), 'utf-8')).length > 0, true);
  });
});
