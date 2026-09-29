import { defineConfig, definePlugin } from '@manablox/core';

/** A plugin whose required plugin is missing, which boot refuses. */
export default defineConfig({
  database: { url: 'postgres://unused' },
  auth: { secret: 'unused' },
  plugins: [definePlugin({ name: 'orphan', requires: ['missing'] })],
});
