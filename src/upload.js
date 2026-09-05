import multer from 'multer';
import { basename, extname, join } from 'node:path';
import { slugify, writeAtomic } from './fs.js';
import { EXT, IMAGE_MIMES, LOOKS_LIKE, makeJpeg, makePicture, shrinkRaster } from './media.js';

// POST /api/upload — multipart `file` + `kind`:
//   kind=image → photo through sharp → { kind:'image', picture } (site.image.kind
//                'picture') or { kind:'image', url } (site.image.kind 'jpeg')
//   kind=file  → stored as-is after a magic-byte sniff → { kind:'file', url }
// `kind` is explicit because mimetype alone is ambiguous — a PNG can be a photo
// or a logo. Filenames are built only from slugify() output plus a fixed
// extension map, so they are unique per upload (no cache busting, no overwrite
// races) and can never escape uploadsDir.
export function uploadRoutes(app, auth, site, { uploadsDir, maxFileSizeMB }) {
  const rawMimes = site.files;
  const labels = [...new Set(['JPG', 'PNG', 'WebP', ...rawMimes.map(m => EXT[m].slice(1).toUpperCase())])];
  const acceptMessage = `Please upload a ${labels.slice(0, -1).join(', ')} or ${labels.at(-1)}`;

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxFileSizeMB * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (IMAGE_MIMES.includes(file.mimetype) || rawMimes.includes(file.mimetype)) cb(null, true);
      else cb(new Error(acceptMessage));
    },
  });

  app.post('/api/upload', auth, (req, res, next) => {
    upload.single('file')(req, res, err => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `That file is too big — max ${maxFileSizeMB} MB.` });
      }
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  }, async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const kind = req.body.kind;
    const { mimetype, originalname } = req.file;
    let { buffer } = req.file;
    const id = `${slugify(basename(originalname, extname(originalname))) || 'upload'}-${Date.now().toString(36)}`;

    try {
      if (kind === 'image') {
        if (!IMAGE_MIMES.includes(mimetype)) return res.status(400).json({ error: 'Photos must be JPG, PNG or WebP' });
        if (site.image.kind === 'picture') {
          const picture = await makePicture(buffer, id, { uploadsDir, uploadsUrl: site.uploadsUrl }).catch(() => null);
          if (!picture) return res.status(400).json({ error: "That doesn't look like a photo" });
          return res.json({ kind: 'image', picture });
        }
        const data = await makeJpeg(buffer, site.image).catch(() => null);
        if (!data) return res.status(400).json({ error: "That doesn't look like a photo" });
        const name = `${id}.jpg`;
        await writeAtomic(join(uploadsDir, name), data);
        return res.json({ kind: 'image', url: `${site.uploadsUrl}/${name}` });
      }
      if (kind === 'file') {
        if (!rawMimes.includes(mimetype)) return res.status(400).json({ error: acceptMessage });
        if (!LOOKS_LIKE[mimetype](buffer)) return res.status(400).json({ error: `That file doesn't look like a valid ${EXT[mimetype].slice(1).toUpperCase()}` });
        if (mimetype === 'image/png' || mimetype === 'image/jpeg') buffer = await shrinkRaster(buffer);
        const name = id + EXT[mimetype];
        await writeAtomic(join(uploadsDir, name), buffer);
        return res.json({ kind: 'file', url: `${site.uploadsUrl}/${name}` });
      }
      res.status(400).json({ error: 'kind must be "image" or "file"' });
    } catch (err) {
      console.error('Upload processing error:', err);
      res.status(500).json({ error: 'Failed to process upload' });
    }
  });
  // ponytail: no DELETE — replaced uploads just sit on disk. Add a sweep of
  // files not referenced by the content JSON if disk ever matters.
}
