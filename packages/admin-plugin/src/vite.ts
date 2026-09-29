import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import type { Plugin, PluginOption, UserConfig } from 'vite';

const VIRTUAL_ID = 'virtual:manablox/admin-plugins';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

/** Modules the admin shares through its import map; plugin bundles import them. */
export const SHARED_MODULES = [
  'vue',
  'vue-router',
  '@tanstack/vue-query',
  'pinia',
  'reka-ui',
  '@manablox/admin-sdk',
] as const;

export interface ManabloxAdminPluginOptions {
  /** Admin plugin source entry module ids. */
  plugins?: string[];
}

/**
 * Emits `virtual:manablox/admin-plugins` as static imports, for the admin's dev server and
 * tests. A production build gets an empty list; it loads plugins at runtime.
 */
export function manabloxAdminPlugins(options: ManabloxAdminPluginOptions = {}): Plugin {
  let ids = options.plugins ?? [];

  return {
    name: 'manablox:admin-plugins',
    enforce: 'pre',

    configResolved(config) {
      if (config.command === 'build') ids = [];
    },

    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },

    load(id) {
      if (id !== RESOLVED_ID) return null;

      if (ids.length === 0) {
        return 'export const adminPlugins = [];\n';
      }

      const imports = ids
        .map((moduleId, index) => `import p${index} from ${JSON.stringify(moduleId)};`)
        .join('\n');
      const list = ids.map((_, index) => `p${index}`).join(', ');

      return `${imports}\nexport const adminPlugins = [${list}];\n`;
    },
  };
}

export interface AdminPluginBuildOptions {
  /** The admin entry, default-exporting `defineAdminPlugin(...)`. Defaults to `src/admin/index.ts`. */
  entry?: string;
  /** Defaults to `dist/admin`. */
  outDir?: string;
  /** The package root; defaults to the working directory. */
  root?: string;
  /** Usually `vue()` and `tailwindcss()`. */
  plugins?: PluginOption[];
  /** The lowest `SDK_API_LEVEL` of `@manablox/admin-sdk` the bundle needs. */
  sdkLevel: number;
}

/** What `dist/admin/manifest.json` holds; the server serves the folder by it. */
export interface AdminBundleManifest {
  /** The plugin package's version. */
  version: string | null;
  entry: string;
  css: string[];
  /** The lowest admin SDK API level it needs. */
  sdkLevel: number;
}

/**
 * Vite config for a plugin's admin bundle: an ES module `entry.js`, its chunks and
 * `style.css` in `dist/admin`, with the shared modules left to the admin.
 */
export function defineAdminPluginBuild(options: AdminPluginBuildOptions): UserConfig {
  const { sdkLevel } = options;
  if (!Number.isInteger(sdkLevel) || sdkLevel < 1) {
    throw new Error(`sdkLevel must be a whole number from 1, got ${sdkLevel}`);
  }
  const root = resolve(options.root ?? process.cwd());
  const outDir = resolve(root, options.outDir ?? 'dist/admin');
  const shared = new Set<string>(SHARED_MODULES);

  return {
    root,
    plugins: [
      ...(options.plugins ?? []),
      adminSfcTypes(),
      bundleManifest(root, outDir, sdkLevel),
      sharedOnly(),
      prefixedUtilities(),
    ],
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      outDir,
      emptyOutDir: true,
      target: 'es2022',
      sourcemap: false,
      minify: true,
      copyPublicDir: false,
      lib: {
        entry: resolve(root, options.entry ?? 'src/admin/index.ts'),
        formats: ['es'],
        fileName: () => 'entry.js',
        cssFileName: 'style',
      },
      rolldownOptions: {
        external: (id) => shared.has(id),
        output: { chunkFileNames: '[name]-[hash].js', minify: true },
      },
    },
  };
}

/** The part of the Vue SFC compiler `adminSfcTypes` uses. */
interface SfcCompiler {
  registerTS?(load: () => unknown): void;
}

/**
 * Resolves the types `defineProps<...>()` and the other macros import with the TypeScript
 * 5.9 this package installs: the Vue SFC compiler needs TypeScript's programmatic API, which
 * TypeScript 7 does not have. It registers with the compiler instance `@vitejs/plugin-vue`
 * resolved, so it works whichever TypeScript the project has. `defineAdminPluginBuild` and
 * `pluginAdminTestConfig` of `@manablox/config-vitest` add it.
 */
export function adminSfcTypes(): Plugin {
  return {
    name: 'manablox:admin-sfc-types',
    configResolved: {
      // After @vitejs/plugin-vue resolved its compiler, before anything is compiled.
      order: 'post',
      handler(config) {
        const vue = config.plugins.find((plugin) => plugin.name === 'vite:vue');
        const api = vue?.api as { options?: { compiler?: SfcCompiler | null } } | undefined;
        api?.options?.compiler?.registerTS?.(loadTypeScript);
      },
    },
  };
}

const loadTypeScript = () => createRequire(import.meta.url)('typescript');

/** Refuses subpaths of shared modules, which the import map does not carry. */
function sharedOnly(): Plugin {
  return {
    name: 'manablox:admin-plugin-shared',
    enforce: 'pre',
    resolveId(id) {
      const base = SHARED_MODULES.find((name) => id.startsWith(`${name}/`));
      if (base) {
        this.error(`"${id}": import "${base}" itself; the admin shares only its main entry.`);
      }
      return null;
    },
  };
}

const PREFIX_HINT =
  'import the preset with the plugin\'s own prefix: @import "@manablox/admin-plugin/tailwind.css" prefix(xy);';

/** Refuses a bundle whose Tailwind utilities lack the plugin's prefix. */
function prefixedUtilities(): Plugin {
  const prefixes = new Set<string>();
  return {
    name: 'manablox:admin-plugin-prefix',
    apply: 'build',
    // Reads each stylesheet before Vite inlines its imports.
    enforce: 'pre',
    buildStart() {
      prefixes.clear();
    },
    transform(_code, id) {
      const file = id.split('?')[0] ?? id;
      if (!file.endsWith('.css')) return null;
      let source: string;
      try {
        source = readFileSync(file, 'utf8');
      } catch {
        return null;
      }
      const prefix = presetPrefix(source);
      if (prefix === '') this.error(`${file}: ${PREFIX_HINT}`);
      if (prefix) prefixes.add(prefix);
      return null;
    },
    generateBundle: {
      // After Vite emitted the extracted CSS, before anything is written.
      order: 'post',
      handler(_options, bundle) {
        if (prefixes.size > 1) {
          this.error(`one prefix per plugin, found ${[...prefixes].join(', ')}`);
        }
        const [prefix] = prefixes;
        for (const file of Object.values(bundle)) {
          if (file.type !== 'asset' || !file.fileName.endsWith('.css')) continue;
          const css = String(file.source);
          if (!prefix) {
            if (utilitySelectors(css).length > 0) this.error(`${file.fileName}: ${PREFIX_HINT}`);
            continue;
          }
          const bare = unprefixedUtilities(css, prefix);
          if (bare.length > 0) {
            this.error(
              `${file.fileName}: utilities without the "${prefix}:" prefix: ${bare.slice(0, 5).join(' ')}`,
            );
          }
        }
      },
    },
  };
}

const PRESET_IMPORT = /@import\s+["']@manablox\/admin-plugin\/tailwind\.css["']([^;]*);/;

/**
 * The prefix a stylesheet imports the preset with: `null` without the preset, `''` with the
 * preset but no `prefix(...)`.
 */
function presetPrefix(source: string): string | null {
  const preset = PRESET_IMPORT.exec(source);
  if (!preset) return null;
  return /\bprefix\(\s*([^)\s]*)\s*\)/.exec(preset[1] ?? '')?.[1] ?? '';
}

/** Splits at top-level commas, outside parentheses and brackets. */
function splitSelectors(prelude: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < prelude.length; index += 1) {
    const char = prelude[index];
    if (char === '\\') index += 1;
    else if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(prelude.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(prelude.slice(start).trim());
  return parts.filter(Boolean);
}

/** The selectors of the style rules in `@layer utilities`, nested rules excluded. */
function utilitySelectors(css: string): string[] {
  const selectors: string[] = [];
  // Per open block: inside the utilities layer, and whether it is a style rule.
  const stack: { utilities: boolean; rule: boolean }[] = [];
  let start = 0;
  for (let index = 0; index < css.length; index += 1) {
    const char = css[index];
    if (char === '\\') {
      index += 1;
    } else if (char === '"' || char === "'") {
      const end = css.indexOf(char, index + 1);
      index = end === -1 ? css.length : end;
    } else if (char === '/' && css[index + 1] === '*') {
      const end = css.indexOf('*/', index + 2);
      index = end === -1 ? css.length : end + 1;
      start = index + 1;
    } else if (char === '{') {
      const prelude = css.slice(start, index).trim();
      const parent = stack.at(-1);
      const rule = !prelude.startsWith('@');
      const utilities = Boolean(parent?.utilities) || prelude === '@layer utilities';
      if (rule && parent?.utilities && !stack.some((frame) => frame.rule)) {
        selectors.push(...splitSelectors(prelude));
      }
      stack.push({ utilities, rule });
      start = index + 1;
    } else if (char === '}') {
      stack.pop();
      start = index + 1;
    } else if (char === ';') {
      start = index + 1;
    }
  }
  return selectors;
}

/** Utility selectors in `css` whose own class, the first one, lacks the `.xy\:` prefix. */
function unprefixedUtilities(css: string, prefix: string): string[] {
  const head = `.${prefix}\\:`;
  return utilitySelectors(css).filter(
    (selector) => !/\.(?:\\.|[\w-])+/.exec(selector)?.[0].startsWith(head),
  );
}

function bundleManifest(root: string, outDir: string, sdkLevel: number): Plugin {
  return {
    name: 'manablox:admin-plugin-manifest',
    apply: 'build',
    // After every plugin added its files, the extracted CSS included.
    writeBundle(_options, bundle) {
      const manifest: AdminBundleManifest = {
        version: packageVersion(join(root, 'package.json')),
        entry: 'entry.js',
        css: Object.keys(bundle).filter((file) => file.endsWith('.css')),
        sdkLevel,
      };
      writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    },
  };
}

function packageVersion(file: string): string | null {
  try {
    return (JSON.parse(readFileSync(file, 'utf8')) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}
