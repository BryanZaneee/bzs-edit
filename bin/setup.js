#!/usr/bin/env node
/**
 * Writes config.json (in the current directory, or the path given) with a bcrypt
 * password hash and a fresh JWT secret. Starts from the existing config.json if
 * there is one, otherwise from the package's config.example.json. Re-running
 * rotates the secret, which logs every device out.
 *
 *   npx bzs-edit-setup <password> [path/to/config.json]
 */
import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const [password, target = 'config.json'] = process.argv.slice(2);
if (!password) {
  console.error('Usage: bzs-edit-setup <password> [config.json]');
  process.exit(1);
}

const configPath = resolve(target);
const example = join(import.meta.dirname, '..', 'config.example.json');
const source = await readFile(configPath, 'utf-8').catch(() => readFile(example, 'utf-8'));
const config = JSON.parse(source);

config.passwordHash = await bcrypt.hash(password, 10);
config.jwtSecret = randomBytes(48).toString('hex');

await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
console.log(`Wrote ${configPath} — password hash + new JWT secret.`);
