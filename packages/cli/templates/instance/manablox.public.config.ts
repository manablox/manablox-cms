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
import { contentTypes } from './content-model.ts';
import { publicPlugins } from './manablox.plugins.ts';

/**
 * The public delivery instance: the same content model, hardened. `server.mode: 'public'`
 * is what does it - no auth, no RPC, no uploads, no draft path, one pinned space, masked
 * errors - and the rest only tunes what is left.
 *
 * `PUBLIC_`-prefixed variables override their management counterparts, so one `.env`
 * drives both processes.
 */
const spaceId = envOptional('MANABLOX_SPACE_ID');
const spaceMachineName = envOptional('MANABLOX_SPACE');
const cacheTtl = envOptionalNumber('PUBLIC_CACHE_TTL');

export default defineConfig({
{{#if sqlite}}
  // The management instance's file; SQLite has no read-only role.
  database: databaseConfigFromEnv(),
{{#else}}
  // PUBLIC_DATABASE_URL, ideally a read-only role (see postgres/init/20-public-role.sh and
  // the README), else DATABASE_URL.
  database: databaseConfigFromEnv({ urlVar: 'PUBLIC_DATABASE_URL' }),
{{/if}}

  server: {
    host: envString('HOST', '0.0.0.0'),
    port: envNumber('PUBLIC_PORT', __PUBLIC_PORT__),
    publicUrl: envString('PUBLIC_API_URL', '__PUBLIC_API_URL__'),
    mode: 'public',
    scopes: [...PUBLIC_SCOPES],
    // Anonymous by construction, so a wide origin costs nothing.
    cors: { origin: '*', credentials: false },
    rateLimit: envOptional('RATE_LIMIT') === 'off' ? false : { window: 60_000, max: 300 },
  },

  publicApi: {
    ...(spaceId ? { spaceId } : {}),
    ...(spaceMachineName ? { spaceMachineName } : {}),
    // Explicit opt-in: a staging deployment is still a public endpoint.
    introspection: envBoolean('PUBLIC_GRAPHQL_INTROSPECTION', false),
    maxDepth: envNumber('PUBLIC_GRAPHQL_MAX_DEPTH', 8),
    maxComplexity: envNumber('PUBLIC_GRAPHQL_MAX_COMPLEXITY', 1000),
    ...(cacheTtl !== undefined ? { cacheTtl } : {}),
  },

  // The query limits are in `publicApi`.
  graphql: { path: '/graphql' },

  // Required by the config shape and used to sign media URLs. No auth surface is mounted,
  // so nothing here can start a session. Must match the management instance, or the
  // transform URLs it signs will not verify here.
  auth: { secret: requireEnv('AUTH_SECRET') },

  storage: storageConfigFromEnv(),

  media: mediaConfigFromEnv({
    cachePathVar: 'PUBLIC_MEDIA_CACHE_PATH',
    cachePath: './data/media-cache-public',
  }),

  cache: cacheConfigFromEnv(300, { ttlVar: 'PUBLIC_CACHE_TTL' }),

  plugins: publicPlugins,
  contentTypes,
  logging: loggingConfigFromEnv(),
});
