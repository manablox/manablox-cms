import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { regionsOf } from '../../src/regions.js';
import { docker, file, render } from '../helpers/create.js';
import { tempDirs } from '../helpers/temp-dir.js';

const biome = createRequire(import.meta.url).resolve('@biomejs/biome/bin/biome');
const tempDir = tempDirs('manablox-biome-');

/** Each region's plugin, anchor and non-comment lines, without the indentation. */
const regions = (content: string) =>
  regionsOf(content).map(({ id, slot, text }) => ({
    id,
    slot,
    code: text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('//')),
  }));

describe('manablox create: biome', () => {
  it("keeps the plugins' regions of manablox.plugins.ts through biome check --write", async () => {
    const dir = tempDir();
    const files = await render(docker(), {}, { ai: true });
    const generated = file(files, 'manablox.plugins.ts');
    // Biome's defaults: the organize-imports assist on, tabs and double quotes.
    writeFileSync(join(dir, 'biome.json'), '{}\n');
    writeFileSync(join(dir, 'manablox.plugins.ts'), generated);
    execFileSync(process.execPath, [biome, 'check', '--write', 'manablox.plugins.ts'], {
      cwd: dir,
      stdio: 'pipe',
    });
    const checked = readFileSync(join(dir, 'manablox.plugins.ts'), 'utf8');
    expect(checked).not.toBe(generated);
    const before = regions(generated.replaceAll("'", '"'));
    expect(before.map(({ id, slot }) => `${slot}:${id}`)).toEqual([
      'config.imports:website',
      'config.imports:ai',
      'config.plugins:website',
      'config.plugins:ai',
      'public.plugins:website',
    ]);
    expect(regions(checked)).toEqual(before);
  });
});
