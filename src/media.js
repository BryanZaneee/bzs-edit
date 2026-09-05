import sharp from 'sharp';
import { join } from 'node:path';
import { writeAtomic } from './fs.js';

// Photos accepted for kind=image. sharp decodes them; anything it can't decode is
// rejected, so the client mimetype is never trusted on its own.
export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

// Raw files (kind=file). A site opts into a subset via `site.files`; the bytes are
// sniffed before landing on disk because the mimetype is client-supplied.
export const EXT = {
  'image/svg+xml': '.svg',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/mpeg': '.mp3',
};
const isIsoBmff = b => b.subarray(4, 8).toString() === 'ftyp'; // mp4, mov, m4a share the container
export const LOOKS_LIKE = {
  'image/png': b => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  'image/jpeg': b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/gif': b => b.subarray(0, 4).toString() === 'GIF8',
  'video/mp4': isIsoBmff,
  'video/quicktime': isIsoBmff,
  'audio/mp4': isIsoBmff,
  'audio/x-m4a': isIsoBmff,
  'audio/mpeg': b => b.subarray(0, 3).toString() === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
  // SVG is XML that can carry script; the site's CSP blocks inline script,
  // but there's no reason to store it at all.
  'image/svg+xml': b => /<svg[\s>]/i.test(b.subarray(0, 2048).toString()) && !/<script|\son\w+\s*=|javascript:/i.test(b.toString()),
};

// Raster files uploaded as kind=file (logos, posters) are still capped at this width.
export const RASTER_MAX_WIDTH = 2000;

// --- picture pipeline ---
// One source photo → AVIF + WebP + JPEG at several widths, returned as the
// `Picture` shape the admin kit and the public sites render. Widths above the
// source are skipped and nothing is upscaled; anything wider than MAX_WIDTH is
// capped there so a phone's 4K original doesn't ship to visitors. sharp strips
// EXIF (GPS included) by default — .rotate() bakes the orientation first.
const MAX_WIDTH = 2000;
const WIDTHS = [320, 640, 1200, 2000];
const FORMATS = {
  avif: { quality: 50, effort: 3 },
  webp: { quality: 75 },
  jpeg: { quality: 80 },
};

export async function makePicture(buffer, id, { uploadsDir, uploadsUrl }) {
  const rotated = await sharp(buffer).rotate().toBuffer();
  const { width } = await sharp(rotated).metadata();
  const max = Math.min(width, MAX_WIDTH);
  const widths = [...WIDTHS.filter(w => w < max), max];
  const sources = {};
  let img;
  for (const [fmt, opts] of Object.entries(FORMATS)) {
    const ext = fmt === 'jpeg' ? 'jpg' : fmt;
    const entries = [];
    for (const w of widths) {
      const name = `${id}-${w}.${ext}`;
      const out = await sharp(rotated).resize(w)[fmt](opts).toBuffer({ resolveWithObject: true });
      await writeAtomic(join(uploadsDir, name), out.data);
      entries.push(`${uploadsUrl}/${name} ${w}w`);
      if (fmt === 'jpeg' && w === max) {
        img = { src: `${uploadsUrl}/${name}`, w: out.info.width, h: out.info.height };
      }
    }
    sources[fmt] = entries.join(', ');
  }
  return { sources, img };
}

// --- single-JPEG pipeline ---
// For sites whose pages render plain <img src> paths: one downscaled JPEG.
export function makeJpeg(buffer, { maxWidth, quality }) {
  return sharp(buffer)
    .rotate()
    .resize(maxWidth, null, { withoutEnlargement: true, fit: 'inside' })
    .jpeg({ quality })
    .toBuffer();
}

export function shrinkRaster(buffer) {
  return sharp(buffer).rotate().resize({ width: RASTER_MAX_WIDTH, withoutEnlargement: true }).toBuffer();
}
