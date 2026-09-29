#!/usr/bin/env node
// Size budget of the prebuilt admin (`apps/admin/dist`), gzipped: what `index.html` loads
// up front (entry, module preloads, stylesheets), all JavaScript, all CSS and the largest
// chunk. Fails when a figure is above `apps/admin/bundle-budget.json`.
//
//   pnpm --filter @manablox/admin build && pnpm admin:budget
//   ANALYZE=1 pnpm --filter @manablox/admin build     (runs this check after the build)
//   pnpm admin:budget --write                          (budget = today's sizes + headroom)
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN = join(ROOT, 'apps/admin');
const BUDGET_FILE = join(ADMIN, 'bundle-budget.json');
/** Room for ordinary growth before the budget has to be raised on purpose. */
const HEADROOM = 1.05;

const kb = (bytes) => Math.round((bytes / 1024) * 10) / 10;
const gzipped = (path) => gzipSync(readFileSync(path), { level: 9 }).length;

/** The admin's sizes in KB (gzip). */
function measure(dist = join(ADMIN, 'dist')) {
  const assets = join(dist, 'assets');
  const files = readdirSync(assets).filter((name) => statSync(join(assets, name)).isFile());
  const sizes = new Map(files.map((name) => [name, gzipped(join(assets, name))]));
  const sum = (names) => names.reduce((total, name) => total + (sizes.get(name) ?? 0), 0);
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const initial = [...html.matchAll(/(?:src|href)="\/assets\/([^"]+\.(?:js|css))"/g)].map(
    (match) => match[1],
  );
  const js = files.filter((name) => name.endsWith('.js'));
  const css = files.filter((name) => name.endsWith('.css'));
  const largest = js.reduce((top, name) => Math.max(top, sizes.get(name) ?? 0), 0);
  return {
    initialKb: kb(sum([...new Set(initial)])),
    jsKb: kb(sum(js)),
    cssKb: kb(sum(css)),
    largestChunkKb: kb(largest),
  };
}

/** Problems of `sizes` against the stored budget; empty when within it. */
function overBudget(sizes) {
  const budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));
  return Object.entries(budget)
    .filter(([key]) => key in sizes && sizes[key] > budget[key])
    .map(([key, limit]) => `${key}: ${sizes[key]} KB gzip, budget ${limit} KB`);
}

{
  const sizes = measure();
  if (process.argv.includes('--write')) {
    const budget = Object.fromEntries(
      Object.entries(sizes).map(([key, value]) => [key, Math.ceil(value * HEADROOM)]),
    );
    writeFileSync(BUDGET_FILE, `${JSON.stringify(budget, null, 2)}\n`);
    console.log(`admin:budget written: ${JSON.stringify(budget)}`);
    process.exit(0);
  }
  const problems = overBudget(sizes);
  console.log(`admin:budget ${JSON.stringify(sizes)}`);
  if (problems.length) {
    console.error(
      `admin:budget over budget (apps/admin/bundle-budget.json):\n  ${problems.join('\n  ')}`,
    );
    process.exit(1);
  }
}
