// Esmé Belle — esmebelle.studio. Two content files, plain <img src> paths, so
// photos become a single JPEG in assets/images (inside the web root).
import { longestString, MAX_STRING } from '../src/content.js';

function validateArtworks(b) {
  if (!Array.isArray(b)) return 'artworks.json must be an array';
  for (let i = 0; i < b.length; i++) {
    const art = b[i];
    if (!art || typeof art !== 'object') return `Artwork at index ${i} must be an object`;
    if (!art.id || typeof art.id !== 'string') return `Artwork at index ${i} missing valid id`;
    if (!art.title || typeof art.title !== 'string') return `Artwork "${art.id}" missing valid title`;
    if (!art.type || typeof art.type !== 'string') return `Artwork "${art.id}" missing valid type`;
    if (!Array.isArray(art.images) || art.images.some(p => typeof p !== 'string')) return `Artwork "${art.id}" images must be a list of paths`;
    if (typeof art.year !== 'number') return `Artwork "${art.id}" missing valid year`;
    if (art.video !== undefined && typeof art.video !== 'string') return `Artwork "${art.id}" video must be a path`;
    if (art.order !== undefined && typeof art.order !== 'number') return `Artwork "${art.id}" order must be a number`;
  }
  if (longestString(b) > MAX_STRING) return `Text fields are limited to ${MAX_STRING} characters`;
  return null;
}

function validateSite(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return 'site.json must be an object';
  if (!b.bio || !Array.isArray(b.bio.sections)) return 'site.json must have bio.sections array';
  if (!Array.isArray(b.social)) return 'site.json must have social array';
  if (b.social.some(s => !/^(https?:|mailto:)/i.test(s?.url ?? ''))) return 'Social links must start with https:// (or mailto:)';
  if (!b.categories || !b.categories.labels || !Array.isArray(b.categories.order)) return 'site.json must have categories with labels and order';
  if (!Array.isArray(b.years) || b.years.some(y => typeof y !== 'number')) return 'site.json must have years as a list of numbers';
  if (longestString(b) > MAX_STRING) return `Text fields are limited to ${MAX_STRING} characters`;
  return null;
}

export default {
  name: 'esme',
  port: 3003,
  uploadsUrl: 'assets/images', // root-relative without a slash, like the seed data in artworks.json
  image: { kind: 'jpeg', maxWidth: 2400, quality: 82 },
  files: ['image/gif', 'video/mp4', 'video/quicktime'],
  content: { 'artworks.json': validateArtworks, 'site.json': validateSite },
};
