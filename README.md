# bzs-edit

bzs-edit is the client-facing site editor behind a handful of static portfolio
and EPK sites: a small Express API that guards one or two JSON content files
and an upload folder behind a password, plus a React admin kit that shows the
real site in a live-updating iframe while the client edits. One shared core,
one short module per site.

Used by: esmebelle.studio, ayopapo.studio, 00jordie.com.

```
content/site.json ──fetch──▶ public page (renders from JSON at runtime)
       ▲                          ▲
       │ PUT /api/content/…       │ postMessage({ type: "content", content: draft })
       │                          │
  /admin/ (React, AdminShell) ────┘ <iframe src="/?preview=1">   same origin
       │
       └── POST /api/upload → content/uploads/*  (sharp → AVIF/WebP/JPEG srcsets, or one JPEG, or raw mp4/m4a/svg)
```

## Installation

Each site depends on this repo straight from GitHub and pins a tag.

```bash
# in the site's api/ directory
npm install github:BryanZaneee/bzs-edit#v0.1.0
npx bzs-edit-setup <admin-password>        # writes api/config.json (hash + JWT secret)

# in the site's root, for the admin kit
npm install github:BryanZaneee/bzs-edit#v0.1.0 react react-dom
```

`config.json` keys: `contentDir` (default `../content`), optional `uploadsDir`
and `backupsDir` (default `<contentDir>/uploads` and `<contentDir>/.backups`),
`maxBackups`, `maxFileSizeMB`, `jwtExpiresIn`, `jwtSecret`, `passwordHash`.
Relative paths resolve from the directory holding `config.json`. Keep it out
of git; the setup script fills the two secrets.

## Usage

### API

A site's whole `api/server.js`:

```js
import { join } from 'node:path';
import { start } from 'bzs-edit';
import site from 'bzs-edit/sites/esme';
start(site, join(import.meta.dirname, 'config.json'));
```

`start` reads the config, binds `127.0.0.1:<site.port>` (override with `PORT`),
and drains in-flight requests on SIGTERM. Caddy or the Vite dev server proxies
`/api/*` to it.

| Method | Path | Auth | Does |
| --- | --- | --- | --- |
| GET | `/api/health` | no | `{ status, site }` |
| POST | `/api/auth/login` | no, 5/min | `{ password }` → `{ token }` (HS256 JWT) |
| GET | `/api/auth/verify` | Bearer | `{ valid: true }` |
| GET | `/api/content/:file` | Bearer | one of the files the site module declares |
| PUT | `/api/content/:file` | Bearer | validate → timestamped backup → atomic write |
| POST | `/api/upload` | Bearer | multipart `file` + `kind` (`image` or `file`) |

Upload responses: `kind=image` returns `{ picture }` (a `Picture` with
AVIF/WebP/JPEG srcsets) on sites with `image.kind: "picture"`, or `{ url }` of
a single downscaled JPEG on sites with `image.kind: "jpeg"`. `kind=file` stores
the bytes as-is after sniffing them and returns `{ url }`. Filenames are
`<slug-of-original>-<base36 time>.<ext>`, unique per upload, so they can be
cached forever and never collide.

### Site module

The only per-site code on the server. Nothing in `src/` branches on a site name.

```js
export default {
  name: 'esme',
  port: 3003,
  uploadsUrl: 'assets/images',                       // public prefix for uploads
  image: { kind: 'jpeg', maxWidth: 2400, quality: 82 }, // or { kind: 'picture' }
  files: ['image/gif', 'video/mp4', 'video/quicktime'], // raw mimes allowed as kind=file
  content: {                                          // file → validator (error string or null)
    'artworks.json': validateArtworks,
    'site.json': validateSite,
  },
};
```

Validators return a plain-English message; the editor shows it as the toast
when a publish is refused. `MAX_STRING` and `longestString` are exported for
the usual 1000-character backstop. Add a site by adding one file under
`sites/` and one test under `tests/`; `npm test` runs every site.

### Admin kit

```tsx
import { AdminShell, getContent, putContent, ListEditor, TextInput, rowScroller } from "bzs-edit/admin";
import "bzs-edit/admin/admin.css";   // after your own :root tokens

<AdminShell
  brand="ESMÉ BELLE"
  screens={[{ key: "bio", title: "Artist statement", blurb: "…", anchor: "#bio-text", page: "/" }]}
  load={() => getContent<Site>("site.json")}
  save={(d) => putContent("site.json", d)}
  render={(draft, key, set) => <BioEditor value={draft.bio} onChange={(bio) => set({ ...draft, bio })} />}
/>
```

`AdminShell` owns sign-in, the home cards, the Undo all / Publish bar, the
mobile Edit | Preview toggle, toasts, the unsaved-changes guard, and the
preview iframe. On every edit it posts `{ type: "content", content: draft }`
to `<page>?preview=1` (debounced 150 ms) and `{ type: "scrollTo", target }`
when a screen or list row opens. The public page must, when `?preview` is in
its URL, listen for those messages instead of fetching JSON:

```js
if (new URLSearchParams(location.search).has('preview')) {
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || e.origin !== location.origin) return;
    if (e.data.type === 'content') render(e.data.content);
    if (e.data.type === 'scrollTo') scrollTo(e.data.target);
  });
} else {
  fetch('/content/site.json', { cache: 'no-cache' }).then(r => r.json()).then(render);
}
```

Re-render only the sections whose JSON changed, or media elements restart on
every keystroke. The kit's CSS expects these tokens from the site:
`--bg --surface --surface-hover --border --border-light --gold --gold-dim
--white --cream --muted --display --body --mono`.

The kit ships as TypeScript source. Add `optimizeDeps: { exclude: ["bzs-edit"] }`
to the site's Vite config so it is compiled by the site's own toolchain.

## Security model

- One shared password, bcrypt-hashed; 30-day HS256 JWT with the algorithm
  pinned, so `alg: none` is rejected. Login is limited to 5/min, the API to
  100/min, behind `trust proxy 1`.
- Content files are an exact-match whitelist from the site module; there is no
  path built from user input. Writes are validated, backed up, then written via
  temp file + rename so a crash cannot truncate the live file.
- Upload filenames come only from `slugify()` plus a fixed extension map. Raw
  files are sniffed by magic bytes; SVGs containing script, event handlers or
  `javascript:` are refused. Photos must decode in sharp, which also strips
  EXIF and GPS.
- The API binds loopback only. Deploy it under a systemd unit with
  `ProtectSystem=strict` and `ReadWritePaths` limited to the content and upload
  directories, since sharp decodes untrusted bytes.
- The public site must send `X-Frame-Options: SAMEORIGIN` and
  `frame-ancestors 'self'` (not `DENY`/`'none'`) or the preview iframe stays
  blank, and should 404 `/content/.backups/*`.
- There is no DELETE: a replaced upload stays on disk. Add a sweep of files
  unreferenced by the content JSON if disk ever matters.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Run `npm test` (Node's built-in runner,
in-process servers on random ports) and `npm run typecheck` before opening a
PR. Never commit a real `config.json`.

## License

[MIT](LICENSE)
