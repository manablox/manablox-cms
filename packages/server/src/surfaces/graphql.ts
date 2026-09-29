import {
  buildSchema,
  type CachedGraphQL,
  createGraphQLServer,
  createTouchedIds,
  type GraphQLRequestParams,
  graphqlCacheKey,
  responseCachePlugin,
  responseDigestPlugin,
  type YogaOptions,
} from '@manablox/api-graphql';
import type { ResponseMeta } from '@manablox/cache';
import {
  ENVIRONMENT_HEADER,
  featureDenied,
  isUuid,
  ManabloxError,
  type ResolvedScope,
  stagingIdOf,
} from '@manablox/core';
import {
  blockDeliveries,
  cachedSpaceRows,
  createLoaders,
  DeliveryReader,
} from '@manablox/services';
import type { Context, Hono } from 'hono';
import type { Runtime } from '../bootstrap.js';
import { errorResponse } from '../errors.js';
import { principal, principalOf } from '../middleware/principal.js';
import { markCached } from '../middleware/served.js';
import { DELIVERY_METRICS, usageRefusal } from '../middleware/usage-gate.js';
import type { SurfaceMode } from './mode.js';
import { publicScopeOf, publicSpaceOf } from './public-host.js';

/** The delivery GraphQL API. Public instances have no preview, no credential lookup, and published-only loaders. */
export function mountGraphQL(app: Hono, runtime: Runtime, mode: SurfaceMode): void {
  const { manablox } = runtime;
  const previewHeader = manablox.config.graphql.previewHeader ?? 'x-manablox-preview';
  const limits = queryLimits(runtime, mode);
  const yoga = createGraphQLServer({
    manablox,
    maxDepth: limits.of('maxDepth'),
    maxComplexity: limits.of('maxComplexity'),
    // The request's space environment on public; otherwise the headers that select the data.
    schemaSpaceId: (request, server) =>
      (server.scope as ResolvedScope | null | undefined) ??
      (mode.isPublic
        ? ((server.spaceId as string | null) ?? null)
        : (request.headers.get('x-manablox-space') ?? undefined)),
    ...(mode.isPublic ? publicServerOptions(runtime, mode) : {}),
    buildContext: deliveryContext(runtime, mode),
  });

  if (mode.isPublic) assertNoMutations(runtime, mode.pinnedSpaceId);
  // Hits are answered before Yoga; persisted operations resolve inside it, so they are not.
  const answersEarly =
    mode.isPublic &&
    manablox.config.cache.enabled &&
    !manablox.config.publicApi.persistedOperations;

  // Preview reads drafts, so it needs a principal; only the preview header resolves one.
  const wantsPreview = principal(runtime, {
    when: (c) => !mode.isPublic && c.req.header(previewHeader) !== undefined,
  });

  app.all(manablox.config.graphql.path, wantsPreview, async (c) => {
    // Shared with the yoga context, so the plugins fill it for the cache middleware.
    const delivery: ResponseMeta = {};
    c.set('delivery', delivery);
    // Hidden until its import finished.
    const spaceId = mode.isPublic ? publicSpaceOf(c) : c.req.header('x-manablox-space');
    if (spaceId && !(await runtime.spaces.isReady(spaceId))) {
      return errorResponse(c, ManabloxError.notFound('space.notFound', { spaceId }));
    }
    // Public: the API host's environment. Management: the environment header, production
    // when absent; another environment needs `environments`.
    let scope: ResolvedScope | null = null;
    if (mode.isPublic) scope = publicScopeOf(c);
    else if (spaceId && isUuid(spaceId)) {
      try {
        scope = await runtime.environments.forRequest(
          spaceId,
          c.req.header(ENVIRONMENT_HEADER) ?? null,
          principalOf(c),
        );
      } catch (error) {
        return errorResponse(c, error);
      }
    }
    // Staging is never indexed.
    if (stagingIdOf(scope)) c.header('x-robots-tag', 'noindex, nofollow');
    const preview = principalOf(c) !== null;
    const refused = await deliveryRefusal(runtime, c, spaceId, preview);
    if (refused) return refused;
    const spaceLimits = await limits.forSpace(spaceId ?? null);
    let request = c.req.raw;
    if (answersEarly && !preview) {
      const early = await readParams(c);
      if (early) request = early.request;
      if (early?.params.query) {
        const key = graphqlCacheKey(spaceId ?? null, scope, early.params, spaceLimits);
        const hit = await runtime.cache.get<CachedGraphQL>(key);
        if (hit && acceptsJson(c, hit.contentType)) {
          delivery.digest = hit.digest;
          markCached(c);
          return c.body(hit.body, 200, {
            'content-type': hit.contentType,
            'content-length': String(Buffer.byteLength(hit.body)),
            ...(stagingIdOf(scope) ? { 'x-robots-tag': 'noindex, nofollow' } : {}),
          });
        }
      }
    }
    const response = await yoga.handle(request, {
      delivery,
      preview,
      limits: spaceLimits,
      scope,
      ...(mode.isPublic ? { spaceId } : {}),
    } as never);
    if (delivery.cached) markCached(c);
    if (stagingIdOf(scope)) response.headers.set('x-robots-tag', 'noindex, nofollow');
    return response;
  });
}

/**
 * The request's parameters as Yoga reads them (GET query string, JSON POST), with the request
 * to hand Yoga afterwards since the body is read here; `null` for anything else.
 */
async function readParams(
  c: Context,
): Promise<{ params: GraphQLRequestParams; request: Request } | null> {
  const raw = c.req.raw;
  try {
    if (raw.method === 'GET') {
      const url = new URL(raw.url);
      const query = url.searchParams.get('query');
      if (!query) return null;
      const variables = url.searchParams.get('variables');
      return {
        params: {
          query,
          variables: variables ? (JSON.parse(variables) as Record<string, unknown>) : null,
          operationName: url.searchParams.get('operationName'),
        },
        request: raw,
      };
    }
    if (raw.method !== 'POST') return null;
    if (!(raw.headers.get('content-type') ?? '').includes('application/json')) return null;
    const text = await raw.text();
    const request = new Request(raw.url, { method: 'POST', headers: raw.headers, body: text });
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { params: {}, request };
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { params: {}, request };
    const { query, variables, operationName } = body as Record<string, unknown>;
    if (typeof query !== 'string') return { params: {}, request };
    return {
      params: {
        query,
        variables:
          variables && typeof variables === 'object'
            ? (variables as Record<string, unknown>)
            : null,
        operationName: typeof operationName === 'string' ? operationName : null,
      },
      request,
    };
  } catch {
    return null;
  }
}

/** Whether Yoga would answer this request with the stored type: plain JSON, unless asked otherwise. */
function acceptsJson(c: Context, contentType: string): boolean {
  if (!contentType.startsWith('application/json')) return false;
  return !(c.req.header('accept') ?? '').includes('application/graphql-response+json');
}

interface QueryLimits {
  maxDepth: number;
  maxComplexity: number;
}

/** Config sets the defaults; `graphql.depth` and `graphql.complexity` override them per space. */
function queryLimits(runtime: Runtime, mode: SurfaceMode) {
  const { manablox } = runtime;
  const publicConfig = manablox.config.publicApi;
  const defaults: QueryLimits = mode.isPublic
    ? { maxDepth: publicConfig.maxDepth ?? 8, maxComplexity: publicConfig.maxComplexity ?? 1000 }
    : {
        maxDepth: manablox.config.graphql.maxDepth,
        maxComplexity: manablox.config.graphql.maxComplexity,
      };
  return {
    /** A space's limits, handed to yoga with the request. */
    forSpace: async (spaceId: string | null): Promise<QueryLimits> => {
      const resolved = await manablox.controls.resolved(spaceId);
      const set = resolved.rateLimitScopes ?? {};
      return {
        maxDepth: set['graphql.depth'] ? resolved.rateLimits['graphql.depth'] : defaults.maxDepth,
        maxComplexity: set['graphql.complexity']
          ? resolved.rateLimits['graphql.complexity']
          : defaults.maxComplexity,
      };
    },
    /** One limit, read back from the request's context. */
    of:
      (name: keyof QueryLimits) =>
      (context: Record<string, unknown>): number =>
        (context.limits as QueryLimits | undefined)?.[name] ?? defaults[name],
  };
}

/** Public instances: masked errors, a pinned space, persisted operations and the response cache. */
function publicServerOptions(runtime: Runtime, mode: SurfaceMode): Partial<YogaOptions> {
  const { manablox } = runtime;
  const publicConfig = manablox.config.publicApi;
  return {
    introspection: publicConfig.introspection ?? false,
    // Always masked, regardless of NODE_ENV.
    maskedErrors: true,
    pinnedSpace: true,
    ...(publicConfig.persistedOperations
      ? { persistedOperations: publicConfig.persistedOperations }
      : {}),
    plugins: [
      errorFlagPlugin(),
      // Before the cache, which stores the digest it computes.
      responseDigestPlugin(),
      // Anonymous, so one entry serves every viewer.
      ...(manablox.config.cache.enabled
        ? [
            responseCachePlugin({
              cache: runtime.cache,
              ttl: mode.cacheTtl,
              onHit: (key) => manablox.logger.debug({ key }, 'delivery cache hit'),
            }),
          ]
        : []),
    ],
  };
}

/** A request's resolver context: loaders and the delivery reader for its space and scope. */
function deliveryContext(runtime: Runtime, mode: SurfaceMode): YogaOptions['buildContext'] {
  const { manablox } = runtime;
  const spaceRows = cachedSpaceRows(manablox, runtime.repos);
  return async (request, server) => {
    const preview = server.preview === true;
    // On public the space comes from the pin or the host, not the header.
    const spaceId = mode.isPublic
      ? ((server.spaceId as string | null) ?? null)
      : request.headers.get('x-manablox-space');
    const scope = (server.scope as ResolvedScope | null | undefined) ?? null;
    const loaders = createLoaders(
      runtime.repos,
      !preview,
      mode.isPublic
        ? { spaceId, environment: scope, publishedAssetsOnly: true, spaceRows }
        : { environment: scope, spaceRows },
    );
    const touched = mode.isPublic ? createTouchedIds() : undefined;

    return {
      manablox,
      repos: runtime.repos,
      content: runtime.content,
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
        published: !preview,
        touched,
      }),
      preview,
      spaceId,
      scope,
      blockData: await blockDeliveries(manablox, spaceId),
      ...(touched ? { touched } : {}),
    };
  };
}

/** Preview needs the visual editor; delivery needs `graphqlDelivery` and usage left. */
async function deliveryRefusal(
  { manablox }: Runtime,
  c: Context,
  spaceId: string | null | undefined,
  preview: boolean,
): Promise<Response | null> {
  if (preview) {
    const editor = await manablox.controls.feature(spaceId ?? null, 'visualEditor');
    return editor.enabled ? null : errorResponse(c, featureDenied('visualEditor', editor));
  }
  if (!(await manablox.controls.feature(spaceId ?? null, 'graphqlDelivery')).enabled) {
    return c.notFound();
  }
  return (await usageRefusal(c, manablox, spaceId, DELIVERY_METRICS)) ?? null;
}

/** Flags a result carrying errors, validation failures included. */
function errorFlagPlugin(): NonNullable<YogaOptions['plugins']>[number] {
  return {
    onResultProcess({ result, serverContext }) {
      const meta = (serverContext as { delivery?: ResponseMeta }).delivery;
      if (!meta) return;
      const results = Array.isArray(result) ? result : [result];
      meta.hasErrors = results.some(
        (each) => !each || Symbol.asyncIterator in each || Boolean(each.errors?.length),
      );
    },
  };
}

/** Refuses to start if the delivery schema has a mutation or subscription, e.g. from a plugin. */
function assertNoMutations(runtime: Runtime, spaceId: string | null): void {
  const schema = buildSchema(runtime.manablox, { pinnedSpace: true, spaceId });
  if (schema.getMutationType() || schema.getSubscriptionType()) {
    throw ManabloxError.badRequest('publicApi.schema.notReadOnly');
  }
}
