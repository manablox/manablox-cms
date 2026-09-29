import type { RequestSurface } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Context, MiddlewareHandler } from 'hono';

declare module 'hono' {
  interface ContextVariableMap {
    /** Set when the answer came from the response cache, for `request:served`. */
    servedFromCache?: boolean;
    /** Set on a refusal that counts as no usage. */
    notMetered?: boolean;
  }
}

export interface ServedOptions {
  /** The surface counted; `null` skips the request. */
  surface: (c: Context) => RequestSurface | null;
  /** Resolved after the response, off its path. */
  spaceId: (c: Context) => string | null | Promise<string | null>;
}

/** Keeps the response out of `request:served`. */
export function markNotMetered(c: Context): void {
  c.set('notMetered', true);
}

/** Marks the response as answered from the response cache. */
export function markCached(c: Context): void {
  c.set('servedFromCache', true);
}

/**
 * Fires `request:served` without delaying the response: bytes come from `content-length`,
 * else are counted as the body streams out. Does nothing while no handler listens. With
 * `control.usageLog` each request is also logged at info level.
 */
export function served(manablox: Manablox, options: ServedOptions): MiddlewareHandler {
  const log = manablox.config.control.usageLog === true;
  return async (c, next) => {
    await next();
    if (!manablox.hooks.has('request:served') || c.get('notMetered')) return;
    const surface = options.surface(c);
    if (!surface) return;

    const { status } = c.res;
    const cached = c.get('servedFromCache') === true || status === 304;
    const fire = (bytes: number) => {
      void (async () => {
        const spaceId = await options.spaceId(c);
        if (log) {
          manablox.logger.info(
            {
              requestId: c.get('requestId'),
              method: c.req.method,
              path: c.req.path,
              surface,
              spaceId,
              status,
              bytes,
              cached,
            },
            'request served',
          );
        }
        await manablox.hooks.observe(
          'request:served',
          { surface, spaceId, status, bytes, cached },
          { manablox, spaceId },
        );
      })().catch((error: unknown) =>
        manablox.logger.warn({ err: error }, 'request:served not reported'),
      );
    };

    // Bodiless, whatever length the headers carried over from the full answer.
    if (status === 304 || status === 204) return fire(0);
    const length = c.res.headers.get('content-length');
    if (length !== null && /^\d+$/.test(length)) return fire(Number(length));
    if (!c.res.body) return fire(0);

    let bytes = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      fire(bytes);
    };
    const reader = c.res.body.getReader();
    const counted = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done: ended, value } = await reader.read();
          if (ended) {
            controller.close();
            finish();
            return;
          }
          bytes += value.byteLength;
          controller.enqueue(value);
        } catch (error) {
          controller.error(error);
          finish();
        }
      },
      cancel(reason) {
        finish();
        return reader.cancel(reason);
      },
    });
    c.res = new Response(counted, {
      status: c.res.status,
      statusText: c.res.statusText,
      headers: c.res.headers,
    });
  };
}
