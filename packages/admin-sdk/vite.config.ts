import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig, type Plugin } from 'vite';
import { iconNames } from './icon-names-plugin.ts';
import pkg from './package.json' with { type: 'json' };

const STYLES = fileURLToPath(new URL('./src/styles/', import.meta.url));

/** Dependencies stay imports; the admin's import map supplies them at runtime. */
const external = Object.keys(pkg.dependencies).map(
  (name) => new RegExp(`^${name.replace('/', '\\/')}(?:\\/|$)`),
);

/**
 * Published build: `dist/index.js`, `dist/testing.js` (sharing its chunks, so its state is
 * the main entry's), and the token and component sheets as source CSS.
 */
export default defineConfig({
  plugins: [vue(), iconNames(), copyStyles()],
  build: {
    target: 'es2022',
    sourcemap: false,
    minify: true,
    lib: {
      entry: { index: 'src/index.ts', testing: 'src/testing.ts' },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
    },
    rolldownOptions: { external },
  },
});

function copyStyles(): Plugin {
  return {
    name: 'manablox:copy-styles',
    apply: 'build',
    generateBundle() {
      for (const file of walk(STYLES)) {
        this.emitFile({
          type: 'asset',
          fileName: `styles/${relative(STYLES, file)}`,
          source: readFileSync(file, 'utf8'),
        });
      }
    },
  };
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}
