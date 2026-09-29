import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');
const STATEMENT = /^(?:import|export)\s+(type\s+)?([^;]*?)\s*from\s*'([^']+)'/gms;

/** Runtime (non type-only) imports reachable from `file`, as `specifier <- importer`. */
function runtimeImports(file: string, seen = new Set<string>()): string[] {
  if (seen.has(file)) return [];
  seen.add(file);
  const out: string[] = [];
  for (const [, typeOnly, clause = '', specifier = ''] of readFileSync(
    join(SRC, file),
    'utf8',
  ).matchAll(STATEMENT)) {
    const named = /^\{([^}]*)\}$/s.exec(clause.trim())?.[1];
    const allTypes = named
      ?.split(',')
      .every((part) => !part.trim() || part.trim().startsWith('type '));
    if (typeOnly || allTypes) continue;
    if (specifier.startsWith('.'))
      out.push(...runtimeImports(join(dirname(file), specifier.replace(/\.js$/, '.ts')), seen));
    else out.push(`${specifier} <- ${file}`);
  }
  return out;
}

describe('browser entry', () => {
  it('reaches no Node builtins or Node-only packages', () => {
    const imports = runtimeImports('index.ts');
    expect(imports.filter((entry) => /^(node:|pino)/.test(entry))).toEqual([]);
  });

  it('the node entry does reach them, so the walk sees through re-exports', () => {
    expect(runtimeImports('entries/node.ts').some((entry) => entry.startsWith('node:'))).toBe(true);
  });
});
