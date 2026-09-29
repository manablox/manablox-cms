import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import type { Plugin, ResolvedConfig } from 'vite';

const COMPRESSIBLE = new Set(['.js', '.mjs', '.css', '.html', '.json', '.svg', '.txt']);
/** Below this a compressed copy saves less than its headers cost. */
const MIN_BYTES = 1024;

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

/**
 * Writes a `.br` (brotli 11) and a `.gz` (gzip 9) copy next to every text file of the build,
 * where it comes out smaller. `@manablox/server` serves them by `accept-encoding`, nginx's
 * `gzip_static` the `.gz` ones. `dist/stats.html` (the bundle report) is left alone.
 */
export function precompress(): Plugin {
  let outDir = '';
  return {
    name: 'manablox:precompress',
    apply: 'build',
    configResolved(config: ResolvedConfig) {
      outDir = join(config.root, config.build.outDir);
    },
    async closeBundle() {
      const files = (await filesUnder(outDir)).filter(
        (file) => COMPRESSIBLE.has(extname(file)) && !file.endsWith('stats.html'),
      );
      await Promise.all(files.map(compressFile));
    },
  };
}

async function compressFile(file: string): Promise<void> {
  const bytes = await readFile(file);
  if (bytes.length < MIN_BYTES) return;
  const [br, gz] = await Promise.all([
    brotli(bytes, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
        [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
        [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
      },
    }),
    gzipAsync(bytes, { level: 9 }),
  ]);
  if (br.length < bytes.length) await writeFile(`${file}.br`, br);
  if (gz.length < bytes.length) await writeFile(`${file}.gz`, gz);
}

async function filesUnder(dir: string): Promise<string[]> {
  const names = await readdir(dir);
  const nested = await Promise.all(
    names.map(async (name) => {
      const path = join(dir, name);
      return (await stat(path)).isDirectory() ? filesUnder(path) : [path];
    }),
  );
  return nested.flat();
}
