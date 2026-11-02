import { libraryConfig } from '@manablox/config-typescript/tsdown';
import { defineConfig } from 'tsdown';

export default defineConfig(
  libraryConfig({
    entry: {
      index: './src/index.ts',
      site: './src/site/index.ts',
      sdk: './src/sdk.ts',
      cli: './src/cli/index.ts',
    },
    // Fragments the CLI renders into a new instance.
    copy: { from: 'src/cli/templates/**/*', to: 'dist', flatten: false },
  }),
);
