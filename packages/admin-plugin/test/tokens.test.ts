import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const file = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));

describe('tokens.css', () => {
  it('matches the admin theme', () => {
    expect(() =>
      execFileSync(process.execPath, [file('scripts/tokens.mjs'), '--check'], { stdio: 'pipe' }),
    ).not.toThrow();
  });

  it('points each token at the admin variable of its name, except query sizes', () => {
    const css = readFileSync(file('tokens.css'), 'utf8');
    const tokens = [...css.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)];
    expect(tokens.length).toBeGreaterThan(100);
    for (const [, name, value] of tokens) {
      if (/^--(breakpoint|container)-/.test(name as string)) expect(value).not.toMatch(/var\(/);
      else expect(value).toBe(`var(${name})`);
    }
    expect(css).not.toMatch(/--color-(red|blue|gray)-/);
  });
});
