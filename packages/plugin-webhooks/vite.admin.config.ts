import { defineAdminPluginBuild } from '@manablox/admin-plugin/vite';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

/** The admin bundle: `dist/admin`, loaded by the prebuilt admin at runtime. */
export default defineConfig(
  defineAdminPluginBuild({ plugins: [vue(), tailwindcss()], sdkLevel: 1 }),
);
