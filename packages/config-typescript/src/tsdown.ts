import type { UserConfig } from 'tsdown';

/** tsdown's config type, so a config file's declarations can name it through this entry. */
export type { UserConfig };

/**
 * Shared build for published libraries (packed only; the workspace uses `src/`). ESM by
 * default, minified, no maps; `@manablox` packages are never bundled. Mangling assumes no
 * code reads a function's or class's `name`.
 */
export function libraryConfig(options: LibraryOptions): UserConfig {
  return {
    entry: options.entry,
    format: options.format ?? ['esm'],
    platform: options.platform ?? 'node',
    // Emit `.js`, not `.mjs`, to match `publishConfig`.
    fixedExtension: false,
    dts: options.dts === false ? false : { sourcemap: false },
    sourcemap: false,
    minify: true,
    clean: options.clean ?? true,
    deps: { neverBundle: [/^@manablox\//] },
    ...(options.copy ? { copy: options.copy } : {}),
  };
}

export interface LibraryOptions {
  /** Output name to source file, e.g. `{ index: 'src/index.ts' }`. */
  entry: Record<string, string>;
  /** `neutral` for code that also runs in a browser. Defaults to `node`. */
  platform?: 'node' | 'neutral';
  /** Defaults to ESM only; add `cjs` for packages that also serve `require`. */
  format?: ('esm' | 'cjs')[];
  /** `false` skips declarations, e.g. for a CLI entry. */
  dts?: boolean;
  /** `false` keeps `dist` when a second build writes into it. Defaults to `true`. */
  clean?: boolean;
  /** Files copied into `dist` verbatim. */
  copy?: UserConfig['copy'];
}
