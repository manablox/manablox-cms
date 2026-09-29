import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests. Start the API on 3000 (throwaway `manablox_e2e` database) and the admin on 3002.
 * Set `E2E_EXTERNAL=1`, `E2E_ADMIN_URL` and `E2E_API_URL` to use running servers.
 *
 * The API uses Redis when `E2E_REDIS_URL` names one (default db 13 on localhost);
 * `E2E_REDIS_URL=off` runs it without.
 *
 * The API also serves the control API with `E2E_CONTROL_API_KEY` (default below), which
 * `controls.spec.ts` uses. `E2E_DATABASE` names the throwaway database.
 *
 * `runtime-plugins.spec.ts` runs against its own instance on `E2E_PLUGINS_URL` (default 3504):
 * the prebuilt admin with the two fixture plugins of `e2e/fixtures/runtime-plugins`, loaded at
 * runtime. External runs skip it unless `E2E_PLUGINS_URL` is set.
 *
 * `core-only.spec.ts` runs against an instance without the feature plugins on
 * `E2E_CORE_URL` (default 3505), with the prebuilt admin the plugins instance builds. External
 * runs skip it unless `E2E_CORE_URL` is set.
 *
 * The API migrates with its plugins (`@manablox/api migrate`), so their tables exist, and runs
 * with a test license (`start:licensed`), the way the premium plugins' repositories run it.
 */
const external = process.env.E2E_EXTERNAL === '1';
const adminUrl = process.env.E2E_ADMIN_URL ?? 'http://localhost:3002';
const apiUrl = process.env.E2E_API_URL ?? 'http://localhost:3000';
const redisUrl = process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/13';
const redis = redisUrl !== 'off' && redisUrl !== '';
const controlKey = process.env.E2E_CONTROL_API_KEY ?? 'e2e-control-key-not-for-production';
const databaseName = process.env.E2E_DATABASE ?? 'manablox_e2e';
const pluginsUrl = process.env.E2E_PLUGINS_URL ?? 'http://localhost:3504';
const runtimePlugins = !external || Boolean(process.env.E2E_PLUGINS_URL);
const coreUrl = process.env.E2E_CORE_URL ?? 'http://localhost:3505';
const coreOnly = !external || Boolean(process.env.E2E_CORE_URL);

const serverUrl =
  process.env.DATABASE_URL ?? 'postgres://manablox:manablox@localhost:5432/manablox';
const databaseUrl = serverUrl.replace(/\/[^/?]*(\?.*)?$/, `/${databaseName}$1`);
const pluginsDatabaseUrl = serverUrl.replace(/\/[^/?]*(\?.*)?$/, `/${databaseName}_plugins$1`);
const coreDatabaseUrl = serverUrl.replace(/\/[^/?]*(\?.*)?$/, `/${databaseName}_core$1`);
const scratch = mkdtempSync(join(tmpdir(), 'manablox-e2e-'));

const authSecret = 'e2e-secret-not-for-production';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: adminUrl,
    trace: 'retain-on-failure',
  },
  // One worker: the tests share one instance. `setup` installs it; the others sign in to
  // it. The workflow action palette needs the editor's `@6xl` container breakpoint.
  workers: 1,
  projects: [
    { name: 'setup', testMatch: 'install.setup.ts' },
    {
      name: 'chromium',
      testMatch: 'smoke.spec.ts',
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } },
    },
    {
      name: 'controls',
      testMatch: 'controls.spec.ts',
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } },
    },
    ...(runtimePlugins
      ? [
          {
            name: 'plugins',
            testMatch: 'runtime-plugins.spec.ts',
            use: {
              ...devices['Desktop Chrome'],
              viewport: { width: 1600, height: 1000 },
              baseURL: pluginsUrl,
            },
          },
        ]
      : []),
    ...(coreOnly
      ? [
          {
            name: 'core-only',
            testMatch: 'core-only.spec.ts',
            use: {
              ...devices['Desktop Chrome'],
              viewport: { width: 1600, height: 1000 },
              baseURL: coreUrl,
            },
          },
        ]
      : []),
  ],
  metadata: { apiUrl, controlKey },
  ...(external
    ? {}
    : {
        webServer: [
          {
            command:
              'pnpm --filter @manablox/db create-db --fresh && pnpm --filter @manablox/api migrate && pnpm --filter @manablox/api start:licensed',
            url: `${apiUrl}/healthz`,
            timeout: 120_000,
            reuseExistingServer: false,
            stdout: 'ignore',
            stderr: 'pipe',
            env: {
              DATABASE_URL: databaseUrl,
              AUTH_SECRET: authSecret,
              STORAGE_LOCAL_PATH: join(scratch, 'uploads'),
              LOG_LEVEL: 'warn',
              NODE_ENV: 'test',
              ...(redis ? { REDIS_URL: redisUrl } : {}),
              PUBLIC_URL: apiUrl,
              CORS_ORIGINS: adminUrl,
              MEDIA_CACHE_PATH: join(scratch, 'media-cache'),
              // The smoke test's workflow calls this instance's own health endpoint.
              NET_ALLOW_PRIVATE_NETWORK: 'true',
              // The management preset plus the control API.
              SCOPES: 'rpc,auth,uploads,media,graphql,control',
              CONTROL_API_KEY: controlKey,
              PORT: new URL(apiUrl).port || '3000',
            },
          },
          {
            command: `pnpm --filter @manablox/admin exec vite --port ${new URL(adminUrl).port || '3002'} --strictPort`,
            url: adminUrl,
            timeout: 120_000,
            reuseExistingServer: false,
            stdout: 'ignore',
            stderr: 'pipe',
            env: { API_URL: apiUrl },
          },
          // Production builds: the admin only loads plugin bundles at runtime there.
          {
            command: [
              'NODE_ENV=production pnpm --filter @manablox/admin build',
              ...['hello', 'hello-extra'].map(
                (name) =>
                  `PLUGIN=${name} NODE_ENV=production pnpm --filter @manablox/admin exec vite build --config e2e/fixtures/runtime-plugins/vite.config.ts`,
              ),
              'pnpm --filter @manablox/db create-db --fresh',
              'pnpm --filter @manablox/api serve:runtime-plugins',
            ].join(' && '),
            url: `${pluginsUrl}/healthz`,
            timeout: 240_000,
            reuseExistingServer: false,
            stdout: 'ignore',
            stderr: 'pipe',
            env: {
              DATABASE_URL: pluginsDatabaseUrl,
              AUTH_SECRET: authSecret,
              STORAGE_LOCAL_PATH: join(scratch, 'uploads-plugins'),
              MEDIA_CACHE_PATH: join(scratch, 'media-cache-plugins'),
              LOG_LEVEL: 'warn',
              NODE_ENV: 'test',
              PUBLIC_URL: pluginsUrl,
              PORT: new URL(pluginsUrl).port || '3504',
            },
          },
          // After the plugins instance, whose command builds the prebuilt admin it serves.
          {
            command:
              'pnpm --filter @manablox/db create-db --fresh && pnpm --filter @manablox/api serve:core-only',
            url: `${coreUrl}/healthz`,
            timeout: 120_000,
            reuseExistingServer: false,
            stdout: 'ignore',
            stderr: 'pipe',
            env: {
              DATABASE_URL: coreDatabaseUrl,
              AUTH_SECRET: authSecret,
              STORAGE_LOCAL_PATH: join(scratch, 'uploads-core'),
              MEDIA_CACHE_PATH: join(scratch, 'media-cache-core'),
              LOG_LEVEL: 'warn',
              NODE_ENV: 'test',
              PUBLIC_URL: coreUrl,
              PORT: new URL(coreUrl).port || '3505',
            },
          },
        ],
      }),
});
