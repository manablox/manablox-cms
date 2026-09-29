import node from '@astrojs/node';
import { defineConfig } from 'astro/config';

/**
 * Server-rendered on Node, so the API URL is read from the environment at start-up
 * rather than inlined into a bundle: one build runs against any instance.
 */
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { host: true, port: __PORT__ },
  devToolbar: { enabled: false },
});
