import { fileURLToPath } from 'node:url';
import { defineAdminPluginBuild } from '@manablox/admin-plugin/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

/**
 * The admin bundle of one fixture plugin, `PLUGIN=hello` or `PLUGIN=hello-extra`, into its
 * `dist`, which the e2e instance (`@manablox/api serve:runtime-plugins`) serves.
 */
const name = process.env.PLUGIN;
if (name !== 'hello' && name !== 'hello-extra') throw new Error('set PLUGIN=hello|hello-extra');

export default defineConfig(
  defineAdminPluginBuild({
    root: fileURLToPath(new URL(`./${name}`, import.meta.url)),
    entry: 'index.ts',
    outDir: 'dist',
    plugins: [vue()],
    sdkLevel: 1,
  }),
);
