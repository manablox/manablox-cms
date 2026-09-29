#!/usr/bin/env node
// Checks that what a published package's build imports at run time is one of its
// `dependencies` (or peer or optional dependencies). pnpm installs a consumer's packages
// strictly, so an import of a devDependency fails there while the workspace resolves it.
// Reads `dist`, so run it after `pnpm build`; what a build bundles is not imported. Admin
// bundles (`dist/admin`) import the admin's shared modules through its import map.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workspacePackages } from './lib/publishable.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** Import specifiers that are text a package writes, not imports: generated frontend code. */
const WRITTEN = {
  '@manablox/cli': ['vue', 'react', '@manablox/live-preview'],
};

function* scripts(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'admin') yield* scripts(path);
    } else if (/\.m?js$/.test(entry)) {
      yield path;
    }
  }
}

// Minified output: `import{a}from"x"`, `export*from"x"`, `import"x"` and `import("x")`.
const IMPORT =
  /(?:^|[^.\w$])(?:import|export)\s*(?:[^'"`;]*?from\s*)?["']([^"'.][^"']*)["']|\bimport\(\s*["']([^"'.][^"']*)["']\s*\)/g;

function packageName(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

let problems = 0;
let packages = 0;
for (const { dir, pkg } of workspacePackages()) {
  if (pkg.private) continue;
  const dist = join(repoRoot, dir, 'dist');
  if (!existsSync(dist)) continue;
  packages++;
  const allowed = new Set([
    pkg.name,
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
    ...(WRITTEN[pkg.name] ?? []),
  ]);
  const reported = new Set();
  for (const file of scripts(dist)) {
    for (const match of readFileSync(file, 'utf8').matchAll(IMPORT)) {
      const specifier = match[1] ?? match[2];
      if (!specifier || /^[a-z]+:/.test(specifier)) continue;
      if (builtinModules.includes(specifier.split('/')[0])) continue;
      const name = packageName(specifier);
      if (!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name) || allowed.has(name)) continue;
      if (reported.has(name)) continue;
      reported.add(name);
      console.error(
        `${pkg.name}: ${relative(repoRoot, file)} imports ${specifier}, which is not in its dependencies`,
      );
      problems++;
    }
  }
}

if (packages === 0) {
  console.error('no built package found; run `pnpm build` first');
  process.exit(1);
}
if (problems > 0) {
  console.error(`${problems} run-time import(s) of packages outside the dependencies`);
  process.exit(1);
}
console.log(`the builds of ${packages} packages import only their dependencies`);
