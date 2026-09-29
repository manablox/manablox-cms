import {
  cacheConfigFromEnv,
  databaseConfigFromEnv,
  defineConfig,
  envBoolean,
  envList,
  envNumber,
  envOptional,
  envScopes,
  envServerMode,
  envString,
  loggingConfigFromEnv,
  mailConfigFromEnv,
  mediaConfigFromEnv,
  requireEnv,
  storageConfigFromEnv,
} from '@manablox/core';
import { plugins } from './plugins.js';

const publicUrl = envString('PUBLIC_URL', 'http://localhost:3000');
const browserOrigins = envList('CORS_ORIGINS', ['http://localhost:3002']);
const adminUrl = envOptional('ADMIN_URL');
const scopes = envScopes();
const mode = envServerMode();
const vapidPublicKey = envOptional('PUSH_VAPID_PUBLIC_KEY');
const vapidPrivateKey = envOptional('PUSH_VAPID_PRIVATE_KEY');

/** Default instance config, overridable by a project's `manablox.config.ts`. */
export const config = defineConfig({
  database: databaseConfigFromEnv(),

  server: {
    host: envString('HOST', '0.0.0.0'),
    port: envNumber('PORT', 3000),
    publicUrl,
    ...(adminUrl ? { adminUrl } : {}),
    cors: { origin: browserOrigins, credentials: true },
    // `SCOPES=graphql,media` makes a public instance, like `apps/public-api`.
    ...(scopes ? { scopes } : {}),
    ...(mode ? { mode } : {}),
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
    trustedOrigins: browserOrigins,
    emailAndPassword: true,
  },

  storage: storageConfigFromEnv(),

  media: { eager: ['thumb'], ...mediaConfigFromEnv() },

  cache: cacheConfigFromEnv(60),

  // `MAIL_DRIVER`: smtp, mailpit, gmail, microsoft, resend, sendgrid, postmark, mailgun or none.
  // Dev Mailpit inbox: http://localhost:8025.
  mail: mailConfigFromEnv(),

  // Generate keys with `pnpm --filter @manablox/api push:keys`.
  push: {
    ...(vapidPublicKey ? { vapidPublicKey } : {}),
    ...(vapidPrivateKey ? { vapidPrivateKey } : {}),
    subject: envString('PUSH_VAPID_SUBJECT', 'mailto:admin@localhost'),
  },

  // Outbound calls to configured URLs (webhooks, plugin steps such as workflow HTTP nodes) may not
  // reach private addresses (SSRF guard) unless this is on.
  net: {
    allowPrivateNetwork: envBoolean('NET_ALLOW_PRIVATE_NETWORK', false),
  },

  plugins,

  // Console by default; `LOG_FILE` and `LOG_HTTP_URL` add file and remote output.
  logging: loggingConfigFromEnv(),
});
