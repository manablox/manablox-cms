#!/usr/bin/env node
// Writes each package's LICENSE file (LICENSES/MIT.txt) and `license` field (MIT). Run it
// after editing LICENSES/MIT.txt; `--check` fails instead of writing, which is what CI runs.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workspacePackages } from './lib/publishable.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const read = (p) => readFileSync(join(root, p), 'utf8');

const mitText = read('LICENSES/MIT.txt');
const MIT_FIELD = 'MIT';

// Private packages without a `license` field are skipped.
const targets = [];
for (const { dir, pkg } of workspacePackages()) {
  if (!pkg.private || 'license' in pkg) targets.push({ dir, text: mitText, field: MIT_FIELD });
}

const check = process.argv.includes('--check');
const stale = [];

for (const { dir, text, field } of targets) {
  const licensePath = join(root, dir, 'LICENSE');
  const manifestPath = join(root, dir, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  // The field sits after `version`, where npm and every reader expects it.
  const next = {};
  for (const [key, value] of Object.entries(manifest)) {
    if (key === 'license') continue;
    next[key] = value;
    if (key === 'version') next.license = field;
  }
  if (!('license' in next)) next.license = field;

  // LICENSE ships with the tarball, so it has to be in `files`.
  if (Array.isArray(next.files) && !next.files.includes('LICENSE')) {
    next.files = [...next.files, 'LICENSE'];
  }

  const manifestText = `${JSON.stringify(next, null, 2)}\n`;
  const currentManifest = readFileSync(manifestPath, 'utf8');
  let currentLicense = null;
  try {
    currentLicense = readFileSync(licensePath, 'utf8');
  } catch {}

  if (currentManifest === manifestText && currentLicense === text) continue;

  if (check) {
    stale.push(relative(root, currentLicense === text ? manifestPath : licensePath));
    continue;
  }
  if (currentLicense !== text) writeFileSync(licensePath, text);
  if (currentManifest !== manifestText) writeFileSync(manifestPath, manifestText);
  console.log(`updated ${dir}`);
}

if (stale.length > 0) {
  console.error('Licence files are out of date:');
  for (const path of stale) console.error(`  ${path}`);
  console.error('\nRun `node scripts/sync-licenses.mjs` and commit the result.');
  process.exit(1);
}
if (!check) console.log('licences in sync');
