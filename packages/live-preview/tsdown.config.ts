import { libraryConfig } from '@manablox/config-typescript/tsdown';
import { defineConfig } from 'tsdown';

// `rich-text` is the rich text schema the admin shares; Tiptap stays an external dependency.
export default defineConfig(
  libraryConfig({
    entry: {
      index: './src/index.ts',
      'rich-text': './src/rich-text.ts',
    },
    platform: 'neutral',
  }),
);
