import {
  keyDigest,
  type ResponseMeta,
  responseDigest,
  type TaggedCache,
  touchedTags,
} from '@manablox/cache';
import { environmentCacheTag, type ResolvedScope, stagingIdOf } from '@manablox/core';
import type { Plugin } from 'graphql-yoga';
import type { GraphQLContext } from './context.js';

export interface ResponseCacheOptions {
  cache: TaggedCache;
  /** Seconds. Also becomes the response's `s-maxage`. */
  ttl: number;
  onHit?: (key: string) => void;
  onMiss?: (key: string) => void;
}

/** A cached answer: the body Yoga serialised, its type and the digest its ETag is built from. */
export interface CachedGraphQL {
  body: string;
  contentType: string;
  digest: string;
}

/** What a request asks, as sent: the cache key is built from it before and inside Yoga. */
export interface GraphQLRequestParams {
  query?: string | null | undefined;
  variables?: Record<string, unknown> | null | undefined;
  operationName?: string | null | undefined;
}

/** The query limits a request is validated against; part of the key, so a change misses. */
export interface GraphQLKeyLimits {
  maxDepth: number;
  maxComplexity: number;
}

/** Cache writes waiting for the body Yoga serialises. */
const pendingWrites = new WeakMap<
  ResponseMeta,
  (entry: Omit<CachedGraphQL, 'digest'> & { digest: string }) => Promise<void>
>();

/**
 * Sets `delivery.digest` from the body Yoga serialised, unless a cache hit already did, and
 * gives the body a `content-length`. Register it before `responseCachePlugin`.
 */
export function responseDigestPlugin(): Plugin {
  return {
    async onResponse({ response, serverContext, setResponse }) {
      const meta = (serverContext as { delivery?: ResponseMeta }).delivery;
      if (!meta) return;
      let body: string | null = null;
      if (!meta.digest && !meta.hasErrors && response.status === 200) {
        if (!(response.headers.get('content-type') ?? '').includes('json')) return;
        body = await response.text();
        meta.digest = responseDigest(body);
        const headers = new Headers(response.headers);
        headers.set('content-length', String(Buffer.byteLength(body)));
        setResponse(
          new Response(body, { status: response.status, statusText: response.statusText, headers }),
        );
      }
      const write = pendingWrites.get(meta);
      pendingWrites.delete(meta);
      if (write && meta.digest && body !== null) {
        await write({
          body,
          contentType: response.headers.get('content-type') ?? 'application/json',
          digest: meta.digest,
        });
      }
    },
  };
}

/**
 * Read-through response cache for the anonymous public API, invalidated by `cache:purge`.
 * Never for management mode, where answers depend on the caller. Needs `responseDigestPlugin`.
 * A hit is normally answered before Yoga (`graphqlCacheKey`, `CachedGraphQL`); this plugin
 * answers the rest, such as persisted operations, and stores what executes.
 */
export function responseCachePlugin(options: ResponseCacheOptions): Plugin {
  return {
    async onExecute({ args, setResultAndStopExecution }) {
      const context = args.contextValue as unknown as GraphQLContext & {
        params?: GraphQLRequestParams;
        limits?: GraphQLKeyLimits;
      };
      // Preview responses hold one editor's drafts.
      if (context.preview) return;

      // The context's space is in every key, so two spaces never share an entry.
      const staging = stagingIdOf(context.scope);
      const key = graphqlCacheKey(
        context.spaceId,
        context.scope,
        {
          query: context.params?.query ?? args.document.loc?.source.body ?? '',
          variables: context.params?.variables ?? args.variableValues,
          operationName: context.params?.operationName ?? null,
        },
        context.limits ?? null,
      );
      const hit = await options.cache.get<CachedGraphQL>(key);

      if (hit) {
        options.onHit?.(key);
        if (context.delivery) {
          context.delivery.digest = hit.digest;
          context.delivery.cached = true;
        }
        setResultAndStopExecution(JSON.parse(hit.body));
        return;
      }
      options.onMiss?.(key);

      return {
        onExecuteDone({ result }) {
          // Never cache a partial or failed result.
          if (!result || Array.isArray(result) || !context.delivery) return;
          const payload = result as { data?: unknown; errors?: unknown[] };
          if (payload.errors?.length || payload.data === undefined) return;

          pendingWrites.set(context.delivery, (entry) =>
            options.cache.set(key, entry, {
              ttl: options.ttl,
              tags: touchedTags(
                context.touched,
                context.spaceId,
                staging && context.spaceId ? environmentCacheTag(context.spaceId, staging) : null,
              ),
            }),
          );
        },
      };
    },
  };
}

/**
 * The cache key of a request: space and environment, normalised query, operation, stably
 * ordered variables and the limits it is validated against.
 */
export function graphqlCacheKey(
  spaceId: string | null,
  scope: ResolvedScope | null | undefined,
  params: GraphQLRequestParams,
  limits: GraphQLKeyLimits | null,
): string {
  const staging = stagingIdOf(scope);
  const space = staging && spaceId ? `${spaceId}:${staging}` : spaceId;
  const normalised = (params.query ?? '').replace(/\s+/g, ' ').trim();
  return `gql:${space ?? 'none'}:${keyDigest(
    normalised,
    params.operationName ?? '',
    stableStringify(params.variables ?? {}),
    limits ? `${limits.maxDepth}:${limits.maxComplexity}` : '',
  )}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}
