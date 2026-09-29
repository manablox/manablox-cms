import {
  cacheConfigFromEnv,
  databaseConfigFromEnv,
  defineConfig,
  envBoolean,
  envNumber,
  envOptional,
  envOptionalNumber,
  envString,
  loggingConfigFromEnv,
  mediaConfigFromEnv,
  PUBLIC_SCOPES,
  requireEnv,
  storageConfigFromEnv,
} from '@manablox/core';
import { manabloxFields } from '@manablox/fields';

const spaceId = envOptional('MANABLOX_SPACE_ID');
const spaceMachineName = envOptional('MANABLOX_SPACE');
const cacheTtl = envOptionalNumber('CACHE_TTL');

/** Hardened public defaults; `server.mode` drops drafts, pins the space and masks errors. */
export const config = defineConfig({
  database: databaseConfigFromEnv(),

  server: {
    host: envString('HOST', '0.0.0.0'),
    port: envNumber('PORT', 3001),
    publicUrl: envString('PUBLIC_URL', 'http://localhost:3001'),
    mode: 'public',
    scopes: [...PUBLIC_SCOPES],
    // Anonymous, so any origin is safe; public mode forces `credentials: false`.
    cors: { origin: '*', credentials: false },
    rateLimit: envOptional('RATE_LIMIT') === 'off' ? false : { window: 60_000, max: 300 },
  },

  publicApi: {
    ...(spaceId ? { spaceId } : {}),
    ...(spaceMachineName ? { spaceMachineName } : {}),
    // Opt-in, even on staging.
    introspection: envBoolean('GRAPHQL_INTROSPECTION', false),
    maxDepth: envNumber('GRAPHQL_MAX_DEPTH', 8),
    maxComplexity: envNumber('GRAPHQL_MAX_COMPLEXITY', 1000),
    ...(cacheTtl !== undefined ? { cacheTtl } : {}),
  },

  // No preview header or limits: public mode reads neither; the limits are in `publicApi`.
  graphql: { path: '/graphql' },

  // Signs media URLs; no auth surface is mounted.
  auth: { secret: requireEnv('AUTH_SECRET') },

  storage: storageConfigFromEnv(),

  media: mediaConfigFromEnv(),

  cache: cacheConfigFromEnv(300),

  // Only plugins that add to what this instance serves. Workflows, webhooks and licenses only
  // act on the management API.
  plugins: [manabloxFields()],
  logging: loggingConfigFromEnv(),
});
