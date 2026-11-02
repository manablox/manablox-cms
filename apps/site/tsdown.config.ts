import { libraryConfig } from '@manablox/config-typescript/tsdown';
import { defineConfig } from 'tsdown';

// The production image runs this with plain `node`; `pnpm dev` stays on tsx.
export default defineConfig(libraryConfig({ entry: { main: './src/main.ts' }, dts: false }));
