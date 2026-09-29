import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOOK_DOCS } from '../src/hook-docs.js';
import { TRANSFORM_HOOKS } from '../src/hook-map.js';

describe('hook-docs.ts', () => {
  it('is current with the hook map', () => {
    const script = join(import.meta.dirname, '../scripts/hook-docs.mjs');
    expect(() =>
      execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' }),
    ).not.toThrow();
  });

  it('lists every hook once, the transforming ones among them', () => {
    const names = HOOK_DOCS.flatMap((section) => section.hooks.map((hook) => hook.name));
    expect(new Set(names).size).toBe(names.length);
    for (const name of TRANSFORM_HOOKS) expect(names).toContain(name);
    expect(HOOK_DOCS.find((section) => section.title === 'lifecycle')?.hooks[0]).toEqual({
      name: 'before:init',
      payload: 'undefined',
      context: 'HookContextBase',
    });
  });
});
