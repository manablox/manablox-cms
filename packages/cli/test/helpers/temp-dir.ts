import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach } from 'vitest';

/** Returns a maker of fresh temp directories, removed after each test (or after all). */
export function tempDirs(prefix: string, after: 'each' | 'all' = 'each'): () => string {
  const dirs: string[] = [];
  (after === 'each' ? afterEach : afterAll)(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  return () => {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  };
}
