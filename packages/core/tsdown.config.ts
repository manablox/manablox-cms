import { libraryConfig } from '@manablox/config-typescript/tsdown';
import { defineConfig } from 'tsdown';

// One neutral build so the entries share chunks; only `/node` reaches `node:` builtins.
const config = libraryConfig({
  entry: {
    index: './src/index.ts',
    node: './src/entries/node.ts',
    'hook-docs': './src/hook-docs.ts',
    testing: './testing/index.ts',
  },
  platform: 'neutral',
});

export default defineConfig({ ...config, deps: { neverBundle: [/^@manablox\//, /^node:/] } });
