import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ISLAND_NAMES, type IslandName } from './types.js';

/** One browser bundle. */
export interface ClientAsset {
  /** Path below the client folder, e.g. `islands/menu.3f2a1c9b0d.js`; served under `/_site/`. */
  fileName: string;
  /** Content hash, part of `fileName`. */
  hash: string;
  code: string;
}

export interface ClientAssets {
  islands: Record<IslandName, ClientAsset>;
  /** The canvas app; see `renderCanvasPage`. */
  canvas: ClientAsset;
  /** Chunks the bundles load on demand, e.g. the canvas's inline rich text editor. */
  chunks: ClientAsset[];
}

const SRC = dirname(fileURLToPath(import.meta.url));

/** Build-time flags of Vue's bundler build. */
const DEFINE = {
  'process.env.NODE_ENV': '"production"',
  __VUE_OPTIONS_API__: 'false',
  __VUE_PROD_DEVTOOLS__: 'false',
  __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
};

/** One bundle: the entry's code and the chunks it imports on demand, below its folder. */
async function bundle(
  entry: string,
  folder = '',
): Promise<{ code: string; chunks: ClientAsset[] }> {
  const { rolldown } = await import('rolldown');
  const build = await rolldown({
    input: join(SRC, entry),
    platform: 'browser',
    transform: { define: DEFINE },
    logLevel: 'warn',
  });
  try {
    // An explicit `sourcemapIgnoreList`: the default function fails across vitest's VM realms.
    const { output } = await build.generate({
      format: 'esm',
      minify: true,
      sourcemapIgnoreList: false,
      chunkFileNames: '[name].[hash].js',
    });
    const chunks = output.filter((file) => file.type === 'chunk');
    const main = chunks.find((file) => file.isEntry);
    if (!main) throw new Error(`No output for ${entry}`);
    return {
      code: main.code,
      chunks: chunks
        .filter((file) => file !== main)
        .map((file) => ({
          fileName: `${folder}${file.fileName}`,
          // Rolldown's hash, which names the file the entry imports.
          hash: file.fileName.split('.').at(-2) ?? '',
          code: file.code,
        })),
    };
  } finally {
    await build.close();
  }
}

function asset(prefix: string, code: string): ClientAsset {
  const hash = createHash('sha256').update(code).digest('hex').slice(0, 10);
  return { fileName: `${prefix}.${hash}.js`, hash, code };
}

/** Bundles every island and the canvas with rolldown; used by the build and when running from source. */
export async function buildClientAssets(): Promise<ClientAssets> {
  const islands = {} as Record<IslandName, ClientAsset>;
  const chunks: ClientAsset[] = [];
  for (const name of ISLAND_NAMES) {
    const island = await bundle(`islands/${name}.ts`, 'islands/');
    islands[name] = asset(`islands/${name}`, island.code);
    chunks.push(...island.chunks);
  }
  const canvas = await bundle('canvas/entry.ts');
  chunks.push(...canvas.chunks);
  return { islands, canvas: asset('canvas', canvas.code), chunks };
}
