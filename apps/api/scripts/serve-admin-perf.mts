/**
 * The instance `scripts/perf/admin-boot.mjs` measures: the prebuilt admin (`apps/admin/dist`)
 * served by the API, with the four feature plugins' admin bundles, as a production instance
 * serves them. Migrates `DATABASE_URL`, then adds `perf@manablox.test` / `perf-password-123`
 * (superadmin) and one space when they are missing. `apps/admin` and the plugins' admin
 * bundles must be built.
 *
 *   DATABASE_URL=... AUTH_SECRET=... PORT=3390 node --import tsx scripts/serve-admin-perf.mts
 */
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
import { bootstrap, createApp, requireManagement, startServer } from '@manablox/server';
import { plugins } from '../src/plugins.js';

const publicUrl = envString('PUBLIC_URL', 'http://localhost:3390');
const config = defineConfig({
  database: databaseConfigFromEnv(),
  server: {
    port: envNumber('PORT', 3390),
    publicUrl,
    admin: { dir: fileURLToPath(new URL('../../admin/dist', import.meta.url)) },
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
const runtime = requireManagement(await bootstrap(config));

const account = { email: 'perf@manablox.test', password: 'perf-password-123' };
const owner =
  (await runtime.repos.users.findByEmail(account.email)) ??
  (await runtime.users.create({
    name: 'Perf',
    ...account,
    role: 'superadmin',
    emailVerified: true,
  }));
if (!(await runtime.repos.spaces.findByMachineName('perf-admin'))) {
  await runtime.spaces.create(
    {
      name: 'Perf admin',
      machineName: 'perf-admin',
      url: 'https://perf-admin.perf.test',
      defaultLocale: 'en',
      locales: ['en'],
    },
    owner.id,
  );
}

startServer(runtime, await createApp(runtime), 'manablox admin perf');
