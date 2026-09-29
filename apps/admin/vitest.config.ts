import { fileURLToPath, URL } from 'node:url';
import { manabloxAdminPlugins } from '@manablox/admin-plugin/vite';
import { iconNames } from '@manablox/admin-sdk/vite';
import { sharedConfig } from '@manablox/config-vitest';
import vue from '@vitejs/plugin-vue';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(
  sharedConfig,
  defineConfig({
    plugins: [vue(), manabloxAdminPlugins(), iconNames()],
    resolve: {
      alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    test: { environment: 'happy-dom' },
  }),
);
