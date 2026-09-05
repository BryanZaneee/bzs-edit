// 00JORDIE: one site.json, responsive Picture uploads, SVG/PNG logos, MP4 hero.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import site from '../sites/jordie.js';
import { jpeg, startSite } from './helpers.js';

const pic = src => ({ sources: { jpeg: `${src} 100w` }, img: { src, w: 100, h: 100 } });
const seed = () => ({
  hero: { eyebrow: '00JORDIE', lines: ['DJ.'], backedLabel: 'Backed By', video: '/media/hero.mp4', poster: '/media/hero-poster.jpg' },
  about: { title: 'Bio', name: 'J', locations: 'GNV', bio: ['hi'], portrait: pic('/content/uploads/p-100.jpg') },
  brands: [{ name: 'FILA' }],
  press: [],
  highlights: [{ year: '2024', brand: 'FILA', desc: 'x', tag: 'Modeling', image: pic('/content/uploads/h-100.jpg') }],
  credits: [{ id: 'modeling', label: 'Modeling', credits: [{ year: '2024', name: 'FILA', role: 'r', description: 'd', thumbs: [] }] }],
  contact: { blurb: 'b', cta: 'c', email: 'e@x.com', socials: [] },
});

let s;
before(async () => {
  s = await startSite(site, { seed: { 'site.json': seed() } });
  await s.login();
});
after(() => s.stop());

describe('jordie content', () => {
  it('reads the seed and refuses other files', async () => {
    assert.equal((await s.api('/api/content/site.json')).body.hero.eyebrow, '00JORDIE');
    assert.equal((await s.api('/api/content/other.json')).status, 404);
  });
  it('refuses broken shapes', async () => {
    assert.equal((await s.api('/api/content/site.json', { method: 'PUT', body: { hero: {} } })).status, 400);
    const put = async mutate => {
      const next = seed();
      mutate(next);
      return (await s.api('/api/content/site.json', { method: 'PUT', body: next })).status;
    };
    assert.equal(await put(x => x.highlights.push({ year: '2025', brand: 'X', desc: '', tag: 'DJ' })), 400); // no image
    assert.equal(await put(x => x.credits[0].credits[0].thumbs.push({ caption: 'no image' })), 400);
    assert.equal(await put(x => x.contact.socials.push({ label: 'x', href: 'javascript:alert(1)' })), 400);
    assert.equal(await put(x => x.contact.socials.push({ label: 'x', href: 'https://instagram.com/x' })), 200);
    assert.equal(await put(x => (x.about.bio[0] = 'a'.repeat(1001))), 400);
    assert.equal(await put(x => (x.brands = 'FILA')), 400);
  });
});

describe('jordie upload', () => {
  it('kind=image → Picture with avif/webp/jpeg srcsets, widths capped at the source', async () => {
    const res = await s.upload('image', await jpeg(), 'image/jpeg', 'My Photo.jpg');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const { picture } = res.body;
    assert.deepEqual(Object.keys(picture.sources), ['avif', 'webp', 'jpeg']);
    assert.match(picture.sources.jpeg, /my-photo-\w+-320\.jpg 320w, .*-640\.jpg 640w, .*-700\.jpg 700w$/);
    assert.deepEqual([picture.img.w, picture.img.h], [700, 500]);
    assert.equal((await readdir(s.uploadsDir)).length, 9); // 3 widths × 3 formats
    const name = picture.img.src.replace('/content/uploads/', '');
    assert.ok((await readFile(join(s.uploadsDir, name))).length > 0);
  });
  it('caps oversized photos at 2000px', async () => {
    const { picture } = (await s.upload('image', await jpeg(3000, 200), 'image/jpeg', 'wide.jpg')).body;
    assert.match(picture.sources.jpeg, /-2000\.jpg 2000w$/);
    assert.equal(picture.img.w, 2000);
  });
  it('accepts logos and video as kind=file, nothing audio', async () => {
    assert.match((await s.upload('file', '<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml', 'logo.svg')).body.url, /^\/content\/uploads\/logo-\w+\.svg$/);
    assert.equal((await s.upload('file', Buffer.concat([Buffer.from('ID3'), Buffer.alloc(32)]), 'audio/mpeg', 'x.mp3')).status, 400);
  });
});
