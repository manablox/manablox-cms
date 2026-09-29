import { defineConfig } from 'vite';

/**
 * No framework plugin and no CSS toolchain: this frontend is one bundle of TypeScript
 * against the delivery API. `pnpm build` produces static files any CDN can serve.
 */
export default defineConfig({
  server: { port: __PORT__ },
  preview: { port: __PORT__ },
  build: { target: 'es2023', sourcemap: true },
});
