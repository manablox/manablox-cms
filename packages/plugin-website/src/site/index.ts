/** The website process: its config from the environment, and its start. */
import {
  cacheConfigFromEnv,
  databaseConfigFromEnv,
  defineConfig,
  envList,
  envNumber,
  envOptional,
  envOptionalNumber,
  envString,
  loggingConfigFromEnv,
  type ManabloxConfig,
  type ManabloxPlugin,
  mediaConfigFromEnv,
  requireEnv,
  storageConfigFromEnv,
} from '@manablox/core';
import { run } from '@manablox/server';
import { type WebsitePluginOptions, websitePlugin } from '../server/plugin.js';

export interface WebsiteProcessOptions {
  /** Plugins next to the website one, e.g. the field types the spaces use. */
  plugins?: ManabloxPlugin[] | undefined;
  /** Options of the website plugin over the ones read from the environment. */
  website?: WebsitePluginOptions | undefined;
}

/**
 * The website process's config from the environment: `DATABASE_URL`, `AUTH_SECRET`, storage,
 * media and cache like the API, `PORT` (3200), `SITE_EDITOR_ORIGIN`, `SITE_FORMS_API_URL` and
 * `SITE_FORMS_SECRET`.
 */
export function websiteProcessConfig(options: WebsiteProcessOptions = {}): ManabloxConfig {
  const cacheTtl = envOptionalNumber('CACHE_TTL');
  const formsApiUrl = envOptional('SITE_FORMS_API_URL');
  const formsSecret = envOptional('SITE_FORMS_SECRET');
  return defineConfig({
    database: databaseConfigFromEnv(),
    server: {
      host: envString('HOST', '0.0.0.0'),
      port: envNumber('PORT', 3200),
      publicUrl: envString('PUBLIC_URL', 'http://localhost:3200'),
      // A page pulls its stylesheet, fonts, images and scripts, so the budget is wider than an API's.
      rateLimit: envOptional('RATE_LIMIT') === 'off' ? false : { window: 60_000, max: 1200 },
    },
    // Verifies share links and signs media URLs; no auth surface is mounted.
    auth: { secret: requireEnv('AUTH_SECRET') },
    storage: storageConfigFromEnv(),
    media: mediaConfigFromEnv(),
    cache: cacheConfigFromEnv(300),
    plugins: [
      ...(options.plugins ?? []),
      websitePlugin({
        // The admin's origin, the only one that may frame the design canvas.
        editorOrigin: envList('SITE_EDITOR_ORIGIN', []),
        ...(cacheTtl !== undefined ? { cacheTtl } : {}),
        // Form submissions, forwarded to the management API; forms are off without both.
        ...(formsApiUrl && formsSecret
          ? { forms: { apiUrl: formsApiUrl, secret: formsSecret } }
          : {}),
        ...options.website,
      }),
    ],
    logging: loggingConfigFromEnv(),
  });
}

/** Starts the website mode: designed spaces rendered by `Host`, no API mounted. */
export function runWebsite(config: ManabloxConfig): Promise<void> {
  return run(config, { mode: 'website' });
}
