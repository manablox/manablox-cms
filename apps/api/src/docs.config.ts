// The instance `pnpm docs:generate` documents: this repository's plugins. The generator loads
// the config without booting it, so the database and the secret are never used.
import { defineConfig } from '@manablox/core';
import { plugins } from './plugins.js';

export default defineConfig({
  database: { url: 'file:unused.db' },
  auth: { secret: 'unused-by-manablox-docs-generate' },
  plugins,
});
