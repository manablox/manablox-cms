import { fileURLToPath, URL } from 'node:url';
import { sharedConfig } from '@manablox/config-vitest';
import vue from '@vitejs/plugin-vue';
import { defineConfig, mergeConfig } from 'vitest/config';

// `#imports` is Nuxt's virtual module; the tests stand in for it.
export default mergeConfig(
  sharedConfig,
  defineConfig({
    plugins: [vue()],
    resolve: {
      alias: {
        '#imports': fileURLToPath(new URL('./test/helpers/nuxt-imports.ts', import.meta.url)),
      },
    },
  }),
);
