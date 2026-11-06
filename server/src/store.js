// Tiny JSON-on-disk store for immutable history (feed rounds, pool logs).
import { mkdirSync, readFileSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CACHE_DIR = process.env.LULL_CACHE_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', '.cache');
mkdirSync(CACHE_DIR, { recursive: true });

export function load(name, fallback) {
  try { return JSON.parse(readFileSync(join(CACHE_DIR, name), 'utf8')); } catch { return fallback; }
}

export function save(name, value) {
  const path = join(CACHE_DIR, name);
  writeFileSync(path + '.tmp', JSON.stringify(value));
  renameSync(path + '.tmp', path);
}

/** Last-modified time (ms) of a cached file, or null. */
export function mtime(name) {
  try { return statSync(join(CACHE_DIR, name)).mtimeMs; } catch { return null; }
}
