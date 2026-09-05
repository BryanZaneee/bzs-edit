// 00JORDIE — 00jordie.com. React site, one site.json, responsive Picture uploads.
import { longestString, MAX_STRING } from '../src/content.js';

function validateSite(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return 'site.json must be an object';
  for (const k of ['hero', 'about', 'contact']) {
    if (!b[k] || typeof b[k] !== 'object') return `Missing "${k}" section`;
  }
  for (const k of ['brands', 'press', 'highlights', 'credits']) {
    if (!Array.isArray(b[k])) return `"${k}" must be a list`;
  }
  if (!Array.isArray(b.hero.lines) || !Array.isArray(b.about.bio) || !Array.isArray(b.contact.socials)) {
    return 'hero.lines, about.bio and contact.socials must be lists';
  }
  const pictures = [
    b.about.portrait,
    ...b.highlights.map(h => h.image),
    ...b.credits.flatMap(t => (t.credits ?? []).flatMap(c => (c.thumbs ?? []).map(th => th.image))),
  ];
  if (pictures.some(p => typeof p?.img?.src !== 'string')) return 'Every highlight and credit photo needs an image before publishing';
  if (b.contact.socials.some(s => !/^(https?:|mailto:)/i.test(s?.href ?? ''))) return 'Social links must start with https:// (or mailto:)';
  if (longestString(b) > MAX_STRING) return `Text fields are limited to ${MAX_STRING} characters`;
  return null;
}

export default {
  name: 'jordie',
  port: 3005,
  uploadsUrl: '/content/uploads',
  image: { kind: 'picture' },
  files: ['image/svg+xml', 'image/png', 'image/jpeg', 'video/mp4'],
  content: { 'site.json': validateSite },
};
