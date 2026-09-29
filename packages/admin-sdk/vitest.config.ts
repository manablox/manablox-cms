import { sharedConfig } from '@manablox/config-vitest';
import vue from '@vitejs/plugin-vue';
import { defineConfig, mergeConfig } from 'vitest/config';
import { iconNames } from './icon-names-plugin.ts';

export default mergeConfig(
  sharedConfig,
  defineConfig({ plugins: [vue(), iconNames()], test: { environment: 'happy-dom' } }),
);
