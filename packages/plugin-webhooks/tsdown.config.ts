import { libraryConfig } from '@manablox/config-typescript/tsdown';
import { defineConfig } from 'tsdown';

export default defineConfig(
  libraryConfig({
    entry: {
      index: './src/index.ts',
      define: './src/define.ts',
      sdk: './src/sdk.ts',
      cli: './src/cli/index.ts',
    },
  }),
);
