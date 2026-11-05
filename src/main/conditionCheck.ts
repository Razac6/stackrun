// "Only run if…" for Dev Notes > Commands - the file system part.
//  - changed: any listed file differs from the last successful run of that step (content
//    hash), or a listed path is missing. Folders only count as present / missing, so
//    `package-lock.json, node_modules` = "install when the lock changed or deps are gone".
//  - missing: any listed path doesn't exist (e.g. `.env` -> copy it from the example).
// What a step saw on its last successful run is kept in a small JSON file.
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { splitPaths } from './stepOptions';

export type Fingerprint = Record<string, string>;

const MAX_HASHED = 64 * 1024 * 1024;

const resolvePath = (cwd: string, p: string) => {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return path.resolve(cwd, p);
};

/** Per path: a content hash, 'dir', or 'missing'. */
export const fingerprint = (cwd: string, target: string): Fingerprint => {
  const result: Fingerprint = {};
  splitPaths(target).forEach((p) => {
    const full = resolvePath(cwd, p);
    try {
      const stat = fs.statSync(full);
      if (stat.isDirectory()) result[p] = 'dir';
      else if (stat.size > MAX_HASHED) {
        result[p] = `size:${stat.size}:${stat.mtimeMs}`;
      } else {
        result[p] = crypto
          .createHash('sha1')
          .update(fs.readFileSync(full, 'latin1'), 'latin1')
          .digest('hex');
      }
    } catch (e) {
      result[p] = 'missing';
    }
  });
  return result;
};

export const missingPaths = (cwd: string, target: string) =>
  splitPaths(target).filter((p) => !fs.existsSync(resolvePath(cwd, p)));

/** Should a "changed" step run, comparing what it saw last time with now. */
export const changedVerdict = (
  previous: Fingerprint | undefined,
  now: Fingerprint,
): { run: boolean; reason: string } => {
  const keys = Object.keys(now);
  const missing = keys.filter((k) => now[k] === 'missing');
  if (missing.length)
    return { run: true, reason: `${missing.join(', ')} missing` };
  if (!previous) {
    return { run: true, reason: 'first run - nothing to compare with yet' };
  }
  const changed = keys.filter((k) => previous[k] !== now[k]);
  if (changed.length)
    return { run: true, reason: `${changed.join(', ')} changed` };
  return {
    run: false,
    reason: `${keys.join(', ')} unchanged since its last successful run`,
  };
};

/** What each step saw on its last successful run (key: command id + folder + paths). */
export class ConditionStore {
  private data: Record<string, Fingerprint> | null = null;

  private file: string | null;

  constructor(file: string | null) {
    this.file = file;
  }

  private load() {
    if (this.data) return this.data;
    this.data = {};
    if (this.file) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (raw && typeof raw === 'object') this.data = raw;
      } catch (e) {
        // no file yet / unreadable: start empty
      }
    }
    return this.data!;
  }

  get(key: string): Fingerprint | undefined {
    return this.load()[key];
  }

  set(key: string, value: Fingerprint) {
    const data = this.load();
    data[key] = value;
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(data));
    } catch (e) {
      // not fatal: it just runs again next time
    }
  }
}
