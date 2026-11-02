import { libraryConfig } from '@manablox/config-typescript/tsdown';
import { defineConfig } from 'tsdown';

// The browser bundles (islands, canvas) are built by scripts/build-client.ts into dist/client.
export default defineConfig([
  libraryConfig({
    entry: { index: './src/index.ts', canvas: './src/canvas/index.ts' },
    platform: 'neutral',
  }),
  libraryConfig({ entry: { assets: './src/assets.ts' }, clean: false }),
]);
