import {
  cacheConfigFromEnv,
  databaseConfigFromEnv,
  defineConfig,
  envBoolean,
  envList,
  envNumber,
  envOptional,
  envString,
  loggingConfigFromEnv,
  mailConfigFromEnv,
  mediaConfigFromEnv,
  requireEnv,
  storageConfigFromEnv,
} from '@manablox/core';
import { contentTypes } from './content-model.ts';
import { plugins } from './manablox.plugins.ts';

/**
 * The management instance: RPC, auth, uploads, media, the management GraphQL API, and the
 * admin at `/`. Anything that differs between environments comes from the environment;
 * the CLI loads a `.env` beside this file, and the shell wins over it.
 */
const publicUrl = envString('PUBLIC_URL', '__ADMIN_URL__');
// The admin is served by this process, so it is same-origin and needs no CORS entry.
// List only your own frontends that call the management API from a browser.
const browserOrigins = envList('CORS_ORIGINS', []);
const vapidPublicKey = envOptional('PUSH_VAPID_PUBLIC_KEY');
const vapidPrivateKey = envOptional('PUSH_VAPID_PRIVATE_KEY');

export default defineConfig({
{{#if sqlite}}
  // DATABASE_URL and DB_POOL_MAX; DATABASE_AUTH_TOKEN only for a remote libSQL or Turso database.
{{#else}}
  // DATABASE_URL and DB_POOL_MAX; DATABASE_SSL=true for TLS.
{{/if}}
  database: databaseConfigFromEnv(),

  server: {
    host: envString('HOST', '0.0.0.0'),
    port: envNumber('PORT', __ADMIN_PORT__),
    publicUrl,
    // Workflow mails and push notifications link here. Same origin as the API because
    // the admin is served from it.
    adminUrl: envString('ADMIN_URL', publicUrl),
    cors: { origin: browserOrigins, credentials: true },
    // `true` serves the bundle shipped in `@manablox/admin`. Point `{ dir }` at your own
    // build instead when you compile the admin with plugins.
    admin: true,
  },

  graphql: {
    path: '/graphql',
    maxDepth: envNumber('GRAPHQL_MAX_DEPTH', 12),
    introspection: process.env.NODE_ENV !== 'production',
    previewHeader: 'x-manablox-preview',
  },

  auth: {
    secret: requireEnv('AUTH_SECRET'),
    baseUrl: publicUrl,
    trustedOrigins: [publicUrl, ...browserOrigins],
    emailAndPassword: true,
  },

  storage: storageConfigFromEnv(),

  // MEDIA_SIGNING_SECRET (defaults to AUTH_SECRET) and MEDIA_CACHE_PATH.
  media: { eager: ['thumb'], ...mediaConfigFromEnv() },

  // The shared cache and the job queue. Every process of this instance must point at the
  // same Valkey so a publish here purges what the public instance serves.
  // CACHE_ENABLED, CACHE_TTL (60 seconds), CACHE_SYNC_INTERVAL and REDIS_URL.
  cache: cacheConfigFromEnv(60),

  // Workflow email steps and notification mails. MAIL_DRIVER in .env picks how they leave.
  mail: mailConfigFromEnv(),

  push: {
    ...(vapidPublicKey ? { vapidPublicKey } : {}),
    ...(vapidPrivateKey ? { vapidPrivateKey } : {}),
    subject: envString('PUSH_VAPID_SUBJECT', 'mailto:admin@localhost'),
  },

  // Outbound calls to configured URLs (workflow HTTP steps, webhooks, AI providers) may not
  // reach private addresses unless this is on.
  net: {
    allowPrivateNetwork: envBoolean('NET_ALLOW_PRIVATE_NETWORK', false),
  },

  // The feature plugins are in manablox.plugins.ts, which `manablox plugin` edits.
  plugins,
  contentTypes,
  logging: loggingConfigFromEnv(),
});
