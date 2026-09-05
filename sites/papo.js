// AYOPAPO — ayopapo.studio. Static site rendered by src/content.js, one
// site.json, responsive Picture uploads plus raw audio for the track list.
import { longestString, MAX_STRING } from '../src/content.js';

const YOUTUBE = /^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i;
const hasPicture = p => typeof p?.img?.src === 'string';

function validateSite(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return 'site.json must be an object';
  for (const k of ['hero', 'bio', 'release', 'events', 'booking']) {
    if (!b[k] || typeof b[k] !== 'object') return `Missing "${k}" section`;
  }
  const lists = { socials: b.socials, sets: b.sets, gallery: b.gallery, 'bio.paragraphs': b.bio.paragraphs, 'release.tags': b.release.tags, 'release.tracks': b.release.tracks, 'events.posters': b.events.posters, 'booking.labels': b.booking.labels };
  for (const [k, v] of Object.entries(lists)) {
    if (!Array.isArray(v)) return `"${k}" must be a list`;
  }
  if (!hasPicture(b.bio.portrait)) return 'The biography needs a portrait photo';
  if (!hasPicture(b.release.cover)) return 'The release needs cover art';
  if (b.gallery.some(g => !hasPicture(g?.image))) return 'Every gallery photo needs an image before publishing';
  if (b.events.posters.some(p => !hasPicture(p?.image) && !p?.video)) return 'Every poster needs an image or a video before publishing';
  if (b.release.tracks.some(t => !t?.audio)) return 'Every track needs an audio file before publishing';
  if (b.socials.some(s => !/^(https?:|mailto:)/i.test(s?.href ?? ''))) return 'Social links must start with https:// (or mailto:)';
  if (b.sets.some(u => !YOUTUBE.test(u))) return 'DJ sets must be YouTube links';
  if (longestString(b) > MAX_STRING) return `Text fields are limited to ${MAX_STRING} characters`;
  return null;
}

export default {
  name: 'papo',
  port: 3006,
  uploadsUrl: '/content/uploads',
  image: { kind: 'picture' },
  files: ['image/svg+xml', 'image/png', 'image/jpeg', 'video/mp4', 'audio/mp4', 'audio/x-m4a', 'audio/mpeg'],
  content: { 'site.json': validateSite },
};
