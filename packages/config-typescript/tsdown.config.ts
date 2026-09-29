import { defineConfig } from 'tsdown';
import { libraryConfig } from './src/tsdown.ts';

export default defineConfig(
  libraryConfig({ entry: { tsdown: './src/tsdown.ts', drizzle: './src/drizzle.ts' } }),
);
