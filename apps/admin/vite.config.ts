import { execFileSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { manabloxAdminPlugins } from '@manablox/admin-plugin/vite';
import { iconNames } from '@manablox/admin-sdk/vite';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig, type PluginOption, type Rolldown } from 'vite';
import { precompress } from './precompress.ts';
import { sharedModules } from './shared-modules.ts';

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    // Plugin sources for the dev server, with HMR; builds load plugin bundles at runtime.
    manabloxAdminPlugins({
      plugins: [
        '@manablox/plugin-license/admin-src',
        '@manablox/plugin-workflows/admin-src',
        '@manablox/plugin-webhooks/admin-src',
      ],
    }),
    // Shared module chunks and the import map plugin bundles resolve them through.
    sharedModules(),
    // Emits `virtual:manablox/icon-names` from the icon files.
    iconNames(),
    // `.br` and `.gz` copies of the build's text files, which the server sends as they are.
    precompress(),
    // `ANALYZE=1 pnpm build` writes a chunk treemap to `dist/stats.html` and fails above the
    // size budget in `bundle-budget.json`.
    ...(process.env.ANALYZE ? [bundleReport(), bundleBudget()] : []),
  ],
  resolve: {
    alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: Number(process.env.PORT ?? 3002),
    proxy: {
      // Same-origin in dev, so the session cookie behaves as in prod.
      '/rpc': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: true },
      '/api': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: true },
      '/media': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: true },
      '/upload': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: true },
      '/transfer': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: true },
      '/realtime': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: true },
    },
  },
  // `dist` is published; source maps would ship the source again.
  build: {
    sourcemap: false,
    // The shared reka-ui entry keeps all of reka-ui; only plugins load it.
    chunkSizeWarningLimit: 600,
    target: 'es2022',
    rolldownOptions: {
      output: {
        // The editor libraries get chunks of their own, apart from eager code.
        advancedChunks: {
          includeDependenciesRecursively: false,
          groups: [
            // Their own small dependencies belong in the chunk too: left outside, they
            // land in the importing chunk and the two import each other, which breaks
            // the editor when the group is entered from the importer's side.
            {
              name: 'tiptap',
              test: /node_modules\/(@tiptap\/|prosemirror-|linkifyjs|orderedmap|rope-sequence|w3c-keyname)/,
            },
            // The SDK the first page does not need, in one chunk rather than ~85 small ones:
            // plugin bundles import all of it through the shared module, and the signed-in
            // pages a good part of it.
            { name: lateSdkChunk(), test: /\/packages\/admin-sdk\/src\// },
          ],
        },
      },
    },
  },
});

/**
 * Puts the SDK modules that neither the entry (`src/main.ts`) nor the sign-in page import
 * statically into one `admin-sdk` chunk; theirs stay where the default splitting puts them,
 * so a signed-out first load fetches no more than it uses.
 */
function lateSdkChunk(): Rolldown.CodeSplittingNameFunction {
  const roots = ['./src/main.ts', './src/pages/Login.vue'].map((path) =>
    fileURLToPath(new URL(path, import.meta.url)),
  );
  let eager: Set<string> | null = null;
  return (id, context) => {
    if (!eager) {
      eager = new Set();
      const pending = [...roots];
      for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
        if (eager.has(next)) continue;
        eager.add(next);
        pending.push(...(context.getModuleInfo(next)?.importedIds ?? []));
      }
    }
    return eager.has(id) ? null : 'admin-sdk';
  };
}

/** Runs `pnpm admin:budget` once the bundle is written; a size over budget fails the build. */
function bundleBudget(): PluginOption {
  return {
    name: 'manablox:bundle-budget',
    apply: 'build',
    closeBundle() {
      execFileSync(
        process.execPath,
        [fileURLToPath(new URL('../../scripts/check-admin-budget.mjs', import.meta.url))],
        { stdio: 'inherit' },
      );
    },
  };
}

function bundleReport(): PluginOption {
  return import('rollup-plugin-visualizer').then(({ visualizer }) =>
    visualizer({ filename: 'dist/stats.html', gzipSize: true, template: 'treemap' }),
  );
}
