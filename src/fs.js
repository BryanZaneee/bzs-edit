import { writeFile, rename, copyFile, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Write via a temp file + rename. rename() is atomic, so an interrupted or failed
// write leaves the original file intact instead of truncated.
let tmpSeq = 0;
export async function writeAtomic(filePath, data) {
  const tmp = `${filePath}.${process.pid}.${tmpSeq++}.tmp`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, filePath);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

// Timestamped copy into backupsDir, pruned to the newest `maxBackups` per file.
export async function backupFile(filePath, backupsDir, maxBackups) {
  if (!existsSync(filePath)) return;
  const name = basename(filePath, '.json');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  await copyFile(filePath, join(backupsDir, `${name}_${timestamp}.json`));

  const files = await readdir(backupsDir);
  const backups = files
    .filter(f => f.startsWith(name + '_') && f.endsWith('.json'))
    .sort()
    .reverse();
  for (const old of backups.slice(maxBackups)) {
    await unlink(join(backupsDir, old)).catch(() => {});
  }
}
