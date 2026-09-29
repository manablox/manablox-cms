import { libraryConfig } from '@manablox/config-typescript/tsdown';
import { defineConfig } from 'tsdown';

export default defineConfig(
  libraryConfig({
    entry: {
      module: './src/module.ts',
    },
    // Nuxt compiles the runtime itself, so it ships as source.
    copy: { from: 'src/runtime/**/*', to: 'dist', flatten: false },
  }),
);
