// Points every workspace package at its built `dist` by applying its `publishConfig`, as
// `pnpm pack` does. Run in the API image's build stage only; the workspace keeps `src`.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

for (const name of readdirSync('packages')) {
  const file = join('packages', name, 'package.json');
  if (!existsSync(file)) continue;
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  if (!pkg.publishConfig) continue;
  const { publishConfig, ...rest } = pkg;
  writeFileSync(file, `${JSON.stringify({ ...rest, ...publishConfig }, null, 2)}\n`);
}
