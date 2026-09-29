import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BELOW_CATALOG, TYPESCRIPT_FOR, VERSIONS } from '../src/versions.js';

/** `name: range` entries of a catalog block in the workspace's `pnpm-workspace.yaml`. */
function catalog(indent: string, header: string): Record<string, string> {
  const yaml = readFileSync(new URL('../../../pnpm-workspace.yaml', import.meta.url), 'utf8');
  const lines = yaml.split('\n');
  const start = lines.indexOf(`${indent.slice(2)}${header}:`);
  expect(start, `${header} in pnpm-workspace.yaml`).toBeGreaterThan(-1);
  const entries: Record<string, string> = {};
  for (const line of lines.slice(start + 1)) {
    if (line.trimStart().startsWith('#')) continue;
    const match = new RegExp(`^${indent}'?([^':\\s]+)'?: (\\S+)$`).exec(line);
    if (!match) break;
    entries[match[1] as string] = match[2] as string;
  }
  return entries;
}

describe('scaffold dependency versions', () => {
  it('match the workspace catalog, except the ones held back on purpose', () => {
    const main = catalog('  ', 'catalog');
    const tracked = Object.entries(VERSIONS).filter(
      ([name]) => name in main && !BELOW_CATALOG.includes(name as keyof typeof VERSIONS),
    );
    expect(tracked.map(([name]) => name)).toContain('typescript');
    for (const [name, range] of tracked) expect(range, name).toBe(main[name]);
    for (const name of BELOW_CATALOG) expect(main[name], name).toBeDefined();
  });

  it('match the named catalogs for the TypeScript that vue-tsc and astro check drive', () => {
    expect(TYPESCRIPT_FOR.vue).toBe(catalog('    ', 'vue').typescript);
    expect(TYPESCRIPT_FOR.astro).toBe(catalog('    ', 'astro').typescript);
  });
});
