import { publicRouter, withoutOutputValidation } from '@manablox/api-public';
import {
  createTouchedIds,
  keyDigest,
  type ResponseMeta,
  responseDigest,
  touchedTags,
} from '@manablox/cache';
import {
  environmentCacheTag,
  ManabloxError,
  type ResolvedScope,
  stagingIdOf,
} from '@manablox/core';
import { cachedSpaceRows, createLoaders, DeliveryReader } from '@manablox/services';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import type { Context, Hono } from 'hono';
import type { Runtime } from '../bootstrap.js';
import { errorResponse, restErrorBody, transportErrors } from '../errors.js';
import { markCached } from '../middleware/served.js';
import { DELIVERY_METRICS, usageRefusal } from '../middleware/usage-gate.js';
import type { SurfaceMode } from './mode.js';
import { openApiDocument } from './openapi.js';
import { publicScopeOf, publicSpaceOf } from './public-host.js';

/** A finished REST answer, stored with the digest its ETag is built from. */
interface CachedResponse {
  body: string;
  contentType: string;
  digest: string;
}

/** The public delivery REST API under `/v1`, with its own OpenAPI document. */
export function mountDelivery(app: Hono, runtime: Runtime, mode: SurfaceMode): void {
  const { manablox } = runtime;
  // Answers are checked against their schemas in development and tests; production skips it.
  const router =
    process.env.NODE_ENV === 'production' ? withoutOutputValidation(publicRouter) : publicRouter;
  const handler = new OpenAPIHandler(router, {
    clientInterceptors: [transportErrors(manablox.logger, { mask: true })],
    customErrorResponseBodyEncoder: restErrorBody,
  });
  // Anonymous and published-only, so one entry serves every viewer.
  const cached = mode.isPublic && manablox.config.cache.enabled;
  const spaceRows = cachedSpaceRows(manablox, runtime.repos);

  const buildContext = (
    spaceId: string,
    scope: ResolvedScope | null,
    touched?: ReturnType<typeof createTouchedIds>,
  ) => {
    // Same loaders as public GraphQL, so both surfaces agree on visibility.
    const loaders = createLoaders(runtime.repos, true, {
      spaceId: spaceId || null,
      environment: scope,
      publishedAssetsOnly: true,
      spaceRows,
    });
    return {
      manablox,
      repos: runtime.repos,
      media: runtime.media,
      menus: runtime.menus,
      loaders,
      reader: new DeliveryReader({
        manablox,
        repos: runtime.repos,
        loaders,
        menus: runtime.menus,
        spaceId,
        scope,
        published: true,
        touched,
      }),
      spaceId,
      scope,
      ...(touched ? { touched } : {}),
    };
  };

  app.all('/v1/*', async (c) => {
    const delivery: ResponseMeta = {};
    c.set('delivery', delivery);
    const space = publicSpaceOf(c);
    const scope = publicScopeOf(c);
    const spaceId = space ?? '';
    // Staging is never indexed.
    const staging = stagingIdOf(scope);
    if (staging) c.header('x-robots-tag', 'noindex, nofollow');
    // Hidden until its import finished.
    if (space && !(await runtime.spaces.isReady(space))) {
      return errorResponse(c, ManabloxError.notFound('space.notFound', { spaceId }));
    }
    if (!(await manablox.controls.feature(space, 'restDelivery')).enabled) {
      return c.notFound();
    }
    const refused = await usageRefusal(c, manablox, space, DELIVERY_METRICS);
    if (refused) return refused;

    const key = cached && c.req.method === 'GET' ? cacheKey(spaceId, staging, c) : null;
    if (key) {
      const hit = await runtime.cache.get<CachedResponse>(key);
      if (hit) {
        manablox.logger.debug({ key }, 'delivery cache hit');
        delivery.digest = hit.digest;
        markCached(c);
        return c.body(hit.body, 200, {
          'content-type': hit.contentType,
          'content-length': String(Buffer.byteLength(hit.body)),
          ...robots(staging),
        });
      }
    }

    const touched = key ? createTouchedIds() : undefined;
    const { matched, response } = await handler.handle(c.req.raw, {
      prefix: '/v1',
      context: buildContext(spaceId, scope, touched),
    });
    if (!matched) return c.notFound();
    if (staging) response.headers.set('x-robots-tag', 'noindex, nofollow');
    if (!mode.isPublic || response.status !== 200) return response;

    // Read once: the body is hashed (and stored) here, so the middleware never has to.
    const body = await response.text();
    const digest = responseDigest(body);
    delivery.digest = digest;
    // A known length keeps the answer off the chunked path.
    response.headers.set('content-length', String(Buffer.byteLength(body)));
    if (!key) return new Response(body, { status: 200, headers: response.headers });
    await runtime.cache.set(
      key,
      { body, contentType: response.headers.get('content-type') ?? '', digest },
      {
        ttl: mode.cacheTtl,
        tags: touchedTags(
          touched,
          space,
          staging && space ? environmentCacheTag(space, staging) : null,
        ),
      },
    );
    return new Response(body, { status: 200, headers: response.headers });
  });

  app.get(
    '/openapi.json',
    openApiDocument(publicRouter, {
      info: {
        title: 'Manablox Delivery API',
        version: '1.0.0',
        description:
          "Read-only access to one space's published content. No authentication; no write operations.",
      },
      servers: [{ url: `${manablox.config.server.publicUrl}/v1` }],
    }),
  );
}

/** Space, staging environment, published projection, path and stably ordered query. */
function cacheKey(spaceId: string, staging: string | null, c: Context): string {
  const params = new URL(c.req.url).searchParams;
  params.sort();
  const space = staging ? `${spaceId}:${staging}` : spaceId;
  return `rest:${space}:published:${keyDigest(c.req.path, params.toString())}`;
}

/** The robots header of a staging answer. */
function robots(staging: string | null): Record<string, string> {
  return staging ? { 'x-robots-tag': 'noindex, nofollow' } : {};
}
