import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BUNDLED_FONTS } from '@manablox/site';
import type { ClientAsset, ClientAssets } from './client-build.js';
import type { IslandName } from './types.js';

export type { ClientAsset, ClientAssets } from './client-build.js';

const here = fileURLToPath(import.meta.url);
/** Running from `src/` (workspace), not from the built `dist/`. */
const fromSource = here.endsWith('.ts');

/** The package folder; `src/` and `dist/` sit directly below it. */
const PACKAGE_ROOT = join(dirname(here), '..');

/** Folder of the bundled font files, served as `/_site/fonts/<bundledPath>`. */
export const FONTS_DIR = join(PACKAGE_ROOT, 'fonts');

/** Where `scripts/build-client.ts` writes the browser bundles. */
export const CLIENT_DIR = join(PACKAGE_ROOT, 'dist', 'client');

const FONT_PATHS = new Set(
  BUNDLED_FONTS.flatMap((family) => family.files.map((file) => file.bundledPath).filter(Boolean)),
);

/** Absolute file of a bundled font path (`inter/Inter-Variable.woff2`); `null` when unknown. */
export function bundledFontFile(path: string): string | null {
  return FONT_PATHS.has(path) ? join(FONTS_DIR, path) : null;
}

let loading: Promise<ClientAssets> | null = null;

/**
 * The island and canvas bundles. From `dist/client` in a built package; from source (with
 * rolldown) in the workspace, once per process.
 */
export function loadClientAssets(): Promise<ClientAssets> {
  loading ??= (async () => {
    if (fromSource) {
      const builder = pathToFileURL(join(dirname(here), 'client-build.ts')).href;
      const module = (await import(builder)) as typeof import('./client-build.js');
      return module.buildClientAssets();
    }
    type Entry = Omit<ClientAsset, 'code'>;
    const manifest = JSON.parse(await readFile(join(CLIENT_DIR, 'manifest.json'), 'utf8')) as {
      islands: Record<IslandName, Entry>;
      canvas: Entry;
      chunks: Entry[];
    };
    const withCode = async (entry: Entry): Promise<ClientAsset> => ({
      ...entry,
      code: await readFile(join(CLIENT_DIR, entry.fileName), 'utf8'),
    });
    const islands = {} as ClientAssets['islands'];
    for (const [name, entry] of Object.entries(manifest.islands) as Array<[IslandName, Entry]>)
      islands[name] = await withCode(entry);
    return {
      islands,
      canvas: await withCode(manifest.canvas),
      chunks: await Promise.all(manifest.chunks.map(withCode)),
    };
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

export interface ClientAssetUrls {
  /** Pass as `RenderOptions.islandSrc`. */
  islandSrc: Record<IslandName, string>;
  /** Pass as `CanvasPageOptions.scriptSrc`. */
  canvasSrc: string;
}

/** Public URLs of the bundles below `base` (default `/_site/`). */
export function clientAssetUrls(assets: ClientAssets, base = '/_site/'): ClientAssetUrls {
  const prefix = base.endsWith('/') ? base : `${base}/`;
  const islandSrc = {} as Record<IslandName, string>;
  for (const [name, entry] of Object.entries(assets.islands) as Array<[IslandName, ClientAsset]>)
    islandSrc[name] = `${prefix}${entry.fileName}`;
  return { islandSrc, canvasSrc: `${prefix}${assets.canvas.fileName}` };
}

/** The bundle or chunk for a path below `/_site/` (`islands/menu.<hash>.js`, `canvas.<hash>.js`). */
export function findClientAsset(assets: ClientAssets, fileName: string): ClientAsset | null {
  if (assets.canvas.fileName === fileName) return assets.canvas;
  return (
    [...Object.values(assets.islands), ...assets.chunks].find(
      (entry) => entry.fileName === fileName,
    ) ?? null
  );
}
