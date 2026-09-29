import { type ResponseMeta, responseDigest } from '@manablox/cache';
import type { MiddlewareHandler } from 'hono';

declare module 'hono' {
  interface ContextVariableMap {
    /** Set by a delivery surface before it answers. */
    delivery?: ResponseMeta;
  }
}

export interface DeliveryCacheOptions {
  /** `s-maxage`, in seconds. */
  ttl: number;
  /** Multiplier for `stale-while-revalidate`. */
  staleFactor?: number;
}

/**
 * Cache headers and ETags for delivery responses. `s-maxage` is GET-only since shared
 * caches do not store POST; the ETag is sent for both. The ETag comes from the digest the
 * surface reports; a handler that reports none has its body hashed here.
 */
export function deliveryCache(options: DeliveryCacheOptions): MiddlewareHandler {
  const stale = options.ttl * (options.staleFactor ?? 10);

  return async (c, next) => {
    await next();

    if (c.res.status !== 200) return;
    const contentType = c.res.headers.get('content-type') ?? '';
    if (!contentType.includes('json')) return;

    const meta = c.get('delivery');
    // Never cache an error response.
    if (meta?.hasErrors) {
      c.res.headers.set('cache-control', 'no-store');
      return;
    }

    const etag = `W/"${meta?.digest ?? (await hashBody(c))}"`;
    c.res.headers.set('etag', etag);
    c.res.headers.set('vary', 'accept-encoding');
    c.res.headers.set(
      'cache-control',
      c.req.method === 'GET'
        ? sharedCacheControl(options.ttl, stale)
        : `public, max-age=0, must-revalidate`,
    );

    if (matchesEtag(c.req.header('if-none-match'), etag)) {
      c.res = new Response(null, {
        status: 304,
        headers: {
          etag,
          'cache-control': c.res.headers.get('cache-control') ?? '',
        },
      });
      // Hono carries the 200's headers over; its length is not this answer's.
      c.res.headers.delete('content-length');
    }
  };
}

/** Revalidated by browsers, kept `ttl` seconds by shared caches. */
export function sharedCacheControl(ttl: number, stale = ttl * 10): string {
  return `public, max-age=0, s-maxage=${ttl}, stale-while-revalidate=${stale}`;
}

/** Fallback for handlers that report no digest: read the body once and put it back. */
async function hashBody(c: Parameters<MiddlewareHandler>[0]): Promise<string> {
  const body = await c.res.text();
  c.res = new Response(body, {
    status: c.res.status,
    statusText: c.res.statusText,
    headers: c.res.headers,
  });
  return responseDigest(body);
}

/** `If-None-Match` may carry a list, and a client may drop the weak marker. */
export function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;
  const strip = (value: string) => value.trim().replace(/^W\//, '');
  return header.split(',').some((candidate) => strip(candidate) === strip(etag));
}
