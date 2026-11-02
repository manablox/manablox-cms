import { libraryConfig } from '@manablox/config-typescript/tsdown';
import { defineConfig } from 'tsdown';

export default defineConfig(
  libraryConfig({ entry: { index: './src/index.ts', 'dom-clock': './src/dom-clock.ts' } }),
);
