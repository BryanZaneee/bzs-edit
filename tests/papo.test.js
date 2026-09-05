// AYOPAPO: one site.json, Picture uploads, YouTube-only sets, raw audio tracks.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import site from '../sites/papo.js';
import { jpeg, mp4, startSite } from './helpers.js';

const pic = src => ({ sources: { jpeg: `${src} 100w` }, img: { src, w: 100, h: 100 } });
const seed = () => ({
  hero: { name: 'AYOPAPO', subtitle: 'Rapper', location: 'GNV', video: '/Assets/Videos/hero-bg.mp4', poster: '/Assets/Videos/hero-bg-poster.jpg' },
  socials: [{ label: 'Instagram', href: 'https://www.instagram.com/papocitoo/' }],
  bio: { heading: 'Biography', portrait: pic('/Assets/Photos/IMG_1228.JPG'), captionName: 'Papocito', captionPlace: 'GNV', paragraphs: ['hi'] },
  release: { title: 'JWTS', cover: pic('/Assets/jookjook.webp'), tags: ['2026'], blurb: 'b', indicia: 'i', tracks: [{ title: 'Gushy', feat: '', badge: '', audio: '/Assets/Music_/1.m4a' }] },
  events: { heading: 'DJ Events', posters: [{ image: pic('/Assets/Posters/poster-01.jpg'), caption: '' }, { video: '/Assets/Videos/a.mp4', caption: 'Arcade' }] },
  sets: ['https://www.youtube.com/watch?v=2tmAzKEgYls'],
  gallery: [{ image: pic('/Assets/Photos/P1010002.JPG'), alt: 'backstage' }],
  booking: { eyebrow: 'Booking', heading: 'BOOK PAPO', sub: 's', email: 'e@x.com', labels: ['Booking'] },
});

let s;
before(async () => {
  s = await startSite(site, { seed: { 'site.json': seed() } });
  await s.login();
});
after(() => s.stop());

describe('papo content', () => {
  it('reads the seed', async () => {
    assert.equal((await s.api('/api/content/site.json')).body.hero.name, 'AYOPAPO');
  });
  it('refuses broken shapes', async () => {
    assert.equal((await s.api('/api/content/site.json', { method: 'PUT', body: { hero: {} } })).status, 400);
    const put = async mutate => {
      const next = seed();
      mutate(next);
      return (await s.api('/api/content/site.json', { method: 'PUT', body: next })).status;
    };
    assert.equal(await put(x => x.gallery.push({ alt: 'no image yet' })), 400);
    assert.equal(await put(x => x.events.posters.push({ caption: 'empty card' })), 400);
    assert.equal(await put(x => x.release.tracks.push({ title: 'x', feat: '', badge: '', audio: '' })), 400);
    assert.equal(await put(x => x.socials.push({ label: 'x', href: 'javascript:alert(1)' })), 400);
    assert.equal(await put(x => x.sets.push('https://vimeo.com/123')), 400);
    assert.equal(await put(x => x.sets.push('https://youtu.be/B8RhRzGLGMg')), 200);
    assert.equal(await put(x => x.socials.push({ label: 'x', href: 'https://instagram.com/x' })), 200);
    assert.equal(await put(x => (x.bio.paragraphs[0] = 'a'.repeat(1001))), 400);
    assert.equal(await put(x => delete x.release.cover), 400);
  });
});

describe('papo upload', () => {
  it('kind=image → Picture', async () => {
    const { picture } = (await s.upload('image', await jpeg(), 'image/jpeg', 'x.jpg')).body;
    assert.deepEqual(Object.keys(picture.sources), ['avif', 'webp', 'jpeg']);
  });
  it('track audio: m4a is an MP4 container, mp3 starts with ID3 or a frame sync', async () => {
    const res = await s.upload('file', mp4('M4A '), 'audio/mp4', 'Gushy ft. Localhotboy.m4a');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.match(res.body.url, /^\/content\/uploads\/gushy-ft-localhotboy-\w+\.m4a$/);
    assert.equal((await s.upload('file', mp4('M4A '), 'audio/x-m4a', 'x.m4a')).status, 200);
    assert.equal((await s.upload('file', Buffer.concat([Buffer.from('ID3'), Buffer.alloc(32)]), 'audio/mpeg', 'x.mp3')).status, 200);
    assert.equal((await s.upload('file', Buffer.from([0xff, 0xfb, 0x90, 0x00, 0, 0, 0, 0]), 'audio/mpeg', 'sync.mp3')).status, 200);
    assert.equal((await s.upload('file', 'not audio', 'audio/mpeg', 'x.mp3')).status, 400);
    assert.equal((await s.upload('file', 'not audio', 'audio/mp4', 'x.m4a')).status, 400);
  });
});
