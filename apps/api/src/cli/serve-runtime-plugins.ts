// The admin e2e's instance for runtime plugin bundles: the prebuilt admin with the two plugins
// of `src/e2e/runtime-plugins.ts`. `apps/admin` and the fixtures' bundles must be built.
// Migrates first.
import { fileURLToPath } from 'node:url';
import {
  databaseConfigFromEnv,
  defineConfig,
  envNumber,
  envString,
  requireEnv,
  storageConfigFromEnv,
} from '@manablox/core';
import { migrateDatabase } from '@manablox/db';
import { manabloxFields } from '@manablox/fields';
import { run } from '@manablox/server';
import { helloExtraPlugin, helloPlugin } from '../e2e/runtime-plugins.js';

const publicUrl = envString('PUBLIC_URL', 'http://localhost:3504');
const plugins = [manabloxFields(), helloPlugin(), helloExtraPlugin()];
const config = defineConfig({
  database: databaseConfigFromEnv(),
  server: {
    port: envNumber('PORT', 3504),
    publicUrl,
    admin: { dir: fileURLToPath(new URL('../../../admin/dist', import.meta.url)) },
  },
  auth: {
    secret: requireEnv('AUTH_SECRET'),
    baseUrl: publicUrl,
    trustedOrigins: [publicUrl],
    emailAndPassword: true,
  },
  storage: storageConfigFromEnv(),
  plugins,
});

await migrateDatabase(config.database, { plugins });
await run(config, { label: 'manablox runtime plugins' });
