// An instance with the core alone: none of the feature plugins, only the built-in field types.
// The admin e2e's `core-only` project runs against it with the prebuilt admin, which
// `apps/admin` must have built. Migrates first.
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

const publicUrl = envString('PUBLIC_URL', 'http://localhost:3505');
const plugins = [manabloxFields()];
const config = defineConfig({
  database: databaseConfigFromEnv(),
  server: {
    port: envNumber('PORT', 3505),
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
await run(config, { label: 'manablox core only' });
