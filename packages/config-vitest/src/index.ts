/**
 * The vitest settings every Manablox package and plugin repository shares. Paths resolve
 * from the package that runs the tests (its working directory, or the `import.meta.url` its
 * config passes), never from where this package is installed.
 */

import { createRequire } from 'node:module';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defineConfig, mergeConfig, type Plugin, type ViteUserConfig } from 'vitest/config';

/**
 * A turbo run of several packages at once (`--concurrency=4`) gives each its own worker
 * pool; left at vitest's default of one worker per core that is 4x the cores, and starved
 * workers hit timeouts. Under turbo each package gets a quarter of the cores; run alone,
 * a package keeps the default.
 */
const underTurbo = Boolean(process.env.TURBO_HASH);

/**
 * Keeps modules that use `import.meta.glob` out of the persistent module cache: their
 * output depends on which files match, which the cache key never sees.
 */
const globsUncached: Plugin = {
  name: 'manablox:globs-uncached',
  configureVitest({ defineCacheKeyGenerator }) {
    defineCacheKeyGenerator(({ sourceCode }) =>
      sourceCode.includes('import.meta.glob') ? false : undefined,
    );
  },
};

/** Base config for every package's `vitest.config.ts`; extend it with `mergeConfig`. */
export const sharedConfig: ViteUserConfig = defineConfig({
  plugins: [globsUncached],
  test: {
    environment: 'node',
    // Tests behave the same in a container that sets NODE_ENV=development.
    env: { NODE_ENV: 'test' },
    include: ['test/**/*.test.ts'],
    ...(underTurbo && { maxWorkers: Math.max(2, Math.floor(availableParallelism() / 4)) }),
    // Headroom for a loaded machine; a test that really hangs still fails.
    testTimeout: 20_000,
    hookTimeout: 60_000,
    // `vi.stubGlobal`/`vi.stubEnv` never leak into the next test, even when one fails.
    unstubGlobals: true,
    unstubEnvs: true,
    // Each file still gets fresh modules (so `vi.mock` stays per file), but workers and
    // the environment are reused; re-importing the graph per file was most of the run.
    pool: 'vmThreads',
    // A VM worker keeps what every file it ran imported; past this heap it is replaced. The
    // largest suites otherwise peak near 3 GB each (about 1.7 GB at this limit,
    // for a few percent of run time), and `pnpm test` runs four packages at once.
    vmMemoryLimit: '300MB',
    // Transformed modules persist across runs.
    fsModuleCache: true,
    // Resolved per package, so the parallel turbo processes never share one cache
    // directory: a package that invalidates its cache deletes only its own files.
    fsModuleCachePath: 'node_modules/.vitest-cache',
  },
});

/**
 * A plugin's server tests: suites seed a real database, and a loaded machine needs the
 * headroom; `test/admin` is left to `pluginAdminTestConfig`.
 */
export function pluginTestConfig(base: ViteUserConfig = sharedConfig): ViteUserConfig {
  return mergeConfig(base, {
    test: { testTimeout: 60_000, exclude: ['test/admin/**', 'node_modules/**'] },
  });
}

/**
 * `adminSfcTypes()` of the `@manablox/admin-plugin` the testing package installs, so the Vue
 * SFC compiler resolves imported prop types with its TypeScript 5.9 even when the project
 * has TypeScript 7; nothing without that package.
 */
function adminSfcTypes(): Promise<Plugin> | undefined {
  let entry: string;
  try {
    entry = createRequire(join(process.cwd(), 'package.json')).resolve(
      '@manablox/admin-plugin/vite',
    );
  } catch {
    return undefined;
  }
  return import(pathToFileURL(entry).href).then((module: { adminSfcTypes(): Plugin }) =>
    module.adminSfcTypes(),
  );
}

/**
 * A plugin's admin tests, `test/admin`, in happy-dom (install `happy-dom`); `plugins` are
 * usually `[vue()]`. With `@manablox/admin-plugin` installed, imported prop types resolve
 * with its TypeScript 5.9. `include` is replaced, since `mergeConfig` would add to the
 * shared one.
 */
export function pluginAdminTestConfig(plugins: Plugin[]): ViteUserConfig {
  const config = mergeConfig(
    sharedConfig,
    defineConfig({ plugins: [...plugins, adminSfcTypes()], test: { environment: 'happy-dom' } }),
  );
  return { ...config, test: { ...config.test, include: ['test/admin/**/*.test.ts'] } };
}

/**
 * The shared config with one graphql build for every importer: `instanceOf` fails across
 * its CJS and ESM builds, so the importers are inlined and `graphql` aliased to the ESM
 * build. `configUrl` is the calling config's `import.meta.url`; `via` names the package
 * graphql is resolved through when the caller does not depend on it directly.
 */
export function graphqlTestConfig(configUrl: string, via?: string): ViteUserConfig {
  const require = createRequire(configUrl);
  const graphqlEsm = require.resolve(
    'graphql/index.mjs',
    via ? { paths: [dirname(require.resolve(via))] } : undefined,
  );
  return mergeConfig(
    sharedConfig,
    defineConfig({
      test: {
        server: {
          deps: {
            inline: [
              /@pothos/,
              /graphql-yoga/,
              /@graphql-yoga/,
              /@graphql-tools/,
              /graphql-scalars/,
            ],
          },
        },
      },
      resolve: {
        alias: [{ find: /^graphql$/, replacement: graphqlEsm }],
        dedupe: ['graphql'],
      },
    }),
  );
}
