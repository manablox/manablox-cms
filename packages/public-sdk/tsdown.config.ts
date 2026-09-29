import { libraryConfig } from '@manablox/config-typescript/tsdown';
import { defineConfig } from 'tsdown';

// A neutral ESM + CJS library build and a Node-only CLI; the CLI keeps `.mjs` for `bin`.
export default defineConfig([
  libraryConfig({
    entry: { index: 'src/index.ts', preview: 'src/preview.ts' },
    format: ['esm', 'cjs'],
    platform: 'neutral',
  }),
  {
    ...libraryConfig({ entry: { cli: 'src/cli.ts' }, dts: false, clean: false }),
    fixedExtension: true,
  },
]);
