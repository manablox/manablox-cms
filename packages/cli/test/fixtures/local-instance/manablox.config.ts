import { defineConfig } from '@manablox/core';
import { greeterPlugin } from './plugins/greeter/index.js';

/** An instance with a plugin kept in its own repository, without a package of its own. */
export default defineConfig({
  database: { url: 'postgres://unused' },
  auth: { secret: 'unused' },
  plugins: [greeterPlugin()],
});
