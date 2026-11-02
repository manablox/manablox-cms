// Writes the island and canvas bundles plus `manifest.json` into dist/client; runs after tsdown.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildClientAssets } from '../src/client-build.js';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'client');
const assets = await buildClientAssets();
for (const entry of [...Object.values(assets.islands), assets.canvas, ...assets.chunks]) {
  const file = join(out, entry.fileName);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, entry.code);
  console.log(`${entry.fileName} (${entry.code.length} bytes)`);
}
// The manifest names the files; their code is read from disk.
const strip = ({ code: _code, ...entry }: (typeof assets)['canvas']) => entry;
const manifest = {
  islands: Object.fromEntries(
    Object.entries(assets.islands).map(([name, entry]) => [name, strip(entry)]),
  ),
  canvas: strip(assets.canvas),
  chunks: assets.chunks.map(strip),
};
await writeFile(join(out, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
