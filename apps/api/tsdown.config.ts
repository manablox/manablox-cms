import { libraryConfig } from '@manablox/config-typescript/tsdown';
import { defineConfig } from 'tsdown';

// The production image runs these with plain `node`; `pnpm dev` stays on tsx.
export default defineConfig(
  libraryConfig({
    entry: { main: './src/main.ts', migrate: './src/cli/migrate.ts' },
    dts: false,
  }),
);
