import { configRateRule } from '@manablox/core';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import type { Runtime } from '../bootstrap.js';
import { attribution } from '../middleware/attribution.js';
import { clientIpResolver, trustedProxyList } from '../middleware/client-ip.js';
import { deliveryCache } from '../middleware/delivery-cache.js';
import { principalOf } from '../middleware/principal.js';
import { currentQueryCount, queryCount } from '../middleware/query-count.js';
import { credentialKey, type RateLimitRequest, rateLimit } from '../middleware/rate-limit.js';
import { served } from '../middleware/served.js';
import type { SurfaceMode } from './mode.js';
import { publicHostResolution, publicSpaceOf } from './public-host.js';

/** Management paths whose `principal()` counts `management.session` per user. */
const PRINCIPAL_PATHS = /^\/(rpc|api\/v1|upload|transfer|realtime|plugins)\//;

/** The prebuilt admin's hashed, immutable files, which the rate limit leaves alone. */
const ADMIN_STATIC = /^\/(assets\/|admin\/plugins\/[^/]+\/[^/]+\/)/;

/** Global middleware stack; `beforeRateLimit` adds middleware ahead of the rate limiter. */
export function mountMiddleware(
  app: Hono,
  runtime: Runtime,
  mode: SurfaceMode,
  beforeRateLimit?: (app: Hono) => void,
): void {
  const { manablox } = runtime;
  const resolveIp = clientIpResolver(
    trustedProxyList(manablox.config.server.trustedProxies, manablox.logger),
  );

  app.use('*', async (c, next) => {
    c.set('clientIp', resolveIp(c));
    await next();
  });
  app.use('*', attribution());
  app.use('*', requestId());
  app.use('*', queryCount({ header: process.env.NODE_ENV !== 'production' }));
  if (mode.plugin) {
    app.use('*', pluginModeHeaders(mode.plugin.headers));
  } else {
    app.use('*', mode.isPublic ? publicSecureHeaders() : managementSecureHeaders());
    app.use('*', mode.isPublic ? publicCors() : managementCors(manablox.config.server.cors));
  }

  // Before anything that can refuse the request, so its errors answer in the GraphQL shape.
  if (mode.scopes.has('graphql')) {
    app.use(manablox.config.graphql.path, async (c, next) => {
      c.set('graphql', true);
      await next();
    });
  }

  // Every later step reads the space it resolves.
  if (mode.isPublic) app.use('*', publicHostResolution(runtime, mode));

  beforeRateLimit?.(app);
  app.use(
    '*',
    rateLimit(() => manablox.controls, surfaceRateLimits(manablox.config.graphql.path, mode)),
  );

  // Request logging with the request id.
  app.use('*', async (c, next) => {
    const started = performance.now();
    await next();
    manablox.logger.debug(
      {
        requestId: c.get('requestId'),
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Math.round(performance.now() - started),
        dbQueries: currentQueryCount(),
      },
      'request',
    );
  });

  // Outside the delivery cache, so it sees its 304s.
  const pinned = (c: Context) =>
    mode.isPublic ? publicSpaceOf(c) : (c.req.header('x-manablox-space') ?? null);
  if (mode.scopes.has('graphql')) {
    app.use(
      manablox.config.graphql.path,
      served(manablox, {
        // A session preview is an editor, not API use.
        surface: (c) => {
          const principal = principalOf(c);
          if (!principal) return 'delivery';
          return principal.viaApiKey ? 'management' : null;
        },
        spaceId: pinned,
      }),
    );
  }
  if (mode.scopes.has('delivery')) {
    app.use('/v1/*', served(manablox, { surface: () => 'delivery', spaceId: pinned }));
  }

  if (mode.isPublic) {
    // Registered before the surfaces so it wraps their responses.
    app.use(manablox.config.graphql.path, deliveryCache({ ttl: mode.cacheTtl }));
    app.use('/v1/*', deliveryCache({ ttl: mode.cacheTtl }));
  }
}

/**
 * The surface's rules: per IP and per space on public, per IP on plugin modes; per API key or
 * per user on management, where signed-in callers are counted by `principal()`.
 */
function surfaceRateLimits(
  graphqlPath: string,
  mode: SurfaceMode,
): (c: Context) => Promise<RateLimitRequest | null> {
  const fallback = configRateRule(mode.rateLimit);
  return async (c) => {
    const ip = c.get('clientIp') ?? 'anonymous';
    if (mode.isPublic) {
      const spaceId = publicSpaceOf(c);
      return {
        spaceId,
        hits: [
          { rule: 'delivery.ip', key: ip, fallback },
          ...(spaceId ? [{ rule: 'delivery.space' as const, key: spaceId }] : []),
        ],
      };
    }
    if (mode.plugin) {
      return {
        spaceId: (await mode.plugin.spaceOf?.(c)) ?? null,
        hits: [{ rule: mode.plugin.rateRule ?? 'delivery.ip', key: ip, fallback }],
      };
    }
    if ((c.req.method === 'GET' || c.req.method === 'HEAD') && ADMIN_STATIC.test(c.req.path)) {
      return null;
    }
    const apiKey = c.req.header('x-api-key');
    if (apiKey) {
      return {
        spaceId: null,
        hits: [{ rule: 'management.apiKey', key: credentialKey(apiKey), fallback }],
      };
    }
    const signedIn = Boolean(c.req.header('cookie') || c.req.header('authorization'));
    if (signedIn && (PRINCIPAL_PATHS.test(c.req.path) || c.req.path === graphqlPath)) {
      c.set('rateLimitDeferred', { rule: 'management.session', fallback });
      return null;
    }
    return { spaceId: null, hits: [{ rule: 'management.session', key: `ip:${ip}`, fallback }] };
  };
}

function publicSecureHeaders() {
  return secureHeaders({
    // `same-origin` would block cross-origin `<img>` loads.
    crossOriginResourcePolicy: 'cross-origin',
    // Not useful on JSON and image endpoints; could break embedders.
    crossOriginOpenerPolicy: false,
    crossOriginEmbedderPolicy: false,
  });
}

/** Media may load in frames of other origins, such as a plugin mode's canvas. */
function managementSecureHeaders(): MiddlewareHandler {
  const strict = secureHeaders();
  const media = secureHeaders({ crossOriginResourcePolicy: 'cross-origin' });
  return (c, next) => (c.req.path.startsWith('/media/') ? media(c, next) : strict(c, next));
}

/** The baseline security headers of a plugin mode, lowercase; the mode's `headers` change them. */
export const PLUGIN_MODE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'cross-origin-resource-policy': 'same-origin',
  'cross-origin-opener-policy': 'same-origin',
  'origin-agent-cluster': '?1',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=15552000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-dns-prefetch-control': 'off',
  'x-download-options': 'noopen',
  'x-frame-options': 'SAMEORIGIN',
  'x-permitted-cross-domain-policies': 'none',
  'x-xss-protection': '0',
});

/** Sets the mode's headers on responses that do not set them themselves. */
function pluginModeHeaders(
  changes: Readonly<Record<string, string | null>> = {},
): MiddlewareHandler {
  const merged: Record<string, string | null> = { ...PLUGIN_MODE_HEADERS };
  for (const [name, value] of Object.entries(changes)) merged[name.toLowerCase()] = value;
  const headers = Object.entries(merged).filter(
    (entry): entry is [string, string] => entry[1] !== null,
  );
  return async (c, next) => {
    await next();
    try {
      for (const [name, value] of headers) {
        if (!c.res.headers.has(name)) c.res.headers.set(name, value);
      }
    } catch {
      // An immutable response keeps its headers.
    }
  };
}

/** Anonymous and read-only, so CORS never allows credentials. */
function publicCors() {
  return cors({
    origin: '*',
    credentials: false,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    // No preview header: preview is unavailable on public.
    allowHeaders: ['content-type'],
  });
}

function managementCors(config: { origin: string[] | '*'; credentials?: boolean } | undefined) {
  const origin = config?.origin ?? [];
  return cors({
    origin: origin === '*' ? '*' : origin,
    // Browsers refuse credentials with a wildcard origin.
    credentials: origin === '*' ? false : (config?.credentials ?? true),
    allowHeaders: [
      'content-type',
      'authorization',
      'x-api-key',
      'x-manablox-preview',
      'x-manablox-space',
      'x-manablox-client',
    ],
  });
}
