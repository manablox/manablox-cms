import { libraryConfig } from '@manablox/config-typescript/tsdown';
import { defineConfig } from 'tsdown';

export default defineConfig([
  // Runs in the admin.
  libraryConfig({ entry: { index: './src/index.ts' }, platform: 'neutral' }),
  // Runs in Vite, on Node.
  libraryConfig({ entry: { vite: './src/vite.ts' }, clean: false }),
]);
