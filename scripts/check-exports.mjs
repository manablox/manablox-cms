#!/usr/bin/env node
// Checks that every package.json entry point (exports, main, types, bin, and their
// publishConfig overrides) names a file that exists. Run after `pnpm build`.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workspacePackages } from './lib/publishable.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** Every file path an entry-point field names, condition objects walked. */
function targets(value) {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(targets);
  return [];
}

function entryPoints(manifest) {
  return ['exports', 'main', 'types', 'bin'].flatMap((field) => targets(manifest?.[field]));
}

let missing = 0;
let checked = 0;
for (const { dir, pkg } of workspacePackages()) {
  for (const target of new Set([...entryPoints(pkg), ...entryPoints(pkg.publishConfig)])) {
    // A subpath pattern (`./dist/*`) needs its directory.
    const path = join(repoRoot, dir, target.includes('*') ? dirname(target.split('*')[0]) : target);
    checked++;
    if (!existsSync(path)) {
      console.error(`${pkg.name}: ${target} does not exist`);
      missing++;
    }
  }
}

if (missing > 0) {
  console.error(`${missing} of ${checked} entry points missing; did \`pnpm build\` run?`);
  process.exit(1);
}
console.log(`${checked} entry points exist`);
