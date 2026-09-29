import { createHash } from 'node:crypto';
import type { TaggedCache } from '@manablox/cache';
import { ManabloxError } from '@manablox/core';
import type { MiddlewareHandler } from 'hono';
import { errorResponse } from '../errors.js';

/** How long a POST response is kept for replay, in seconds. */
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

const HEADER = 'idempotency-key';
const MAX_KEY_LENGTH = 255;

interface StoredResponse {
  /** Method, path, query and body, hashed; a key reused for another request is refused. */
  fingerprint: string;
  status: number;
  contentType: string;
  body: string;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Replays the stored response of a POST that repeats its `Idempotency-Key`. Responses below
 * 500 are kept for a day; concurrent requests with one key run once per process.
 */
export function idempotency(
  store: TaggedCache,
  logger: { warn(object: object, message: string): void },
): MiddlewareHandler {
  const running = new Map<string, Promise<void>>();

  return async (c, next) => {
    const key = c.req.header(HEADER);
    if (c.req.method !== 'POST' || !key) return next();
    if (key.length > MAX_KEY_LENGTH) {
      return errorResponse(
        c,
        ManabloxError.validation([
          { key: 'validation.invalid', path: ['Idempotency-Key'], params: { maximum: 255 } },
        ]),
      );
    }

    const url = new URL(c.req.url);
    const fingerprint = sha256(
      `${c.req.method} ${url.pathname}${url.search}\n${await c.req.raw.clone().text()}`,
    );
    const cacheKey = `control:idempotency:${sha256(key)}`;

    while (running.has(cacheKey)) await running.get(cacheKey);
    let done = () => {};
    running.set(
      cacheKey,
      new Promise<void>((resolve) => {
        done = resolve;
      }),
    );
    try {
      const stored = await store.get<StoredResponse>(cacheKey);
      if (stored) {
        if (stored.fingerprint !== fingerprint) {
          return errorResponse(c, ManabloxError.conflict('control.idempotency.mismatch'));
        }
        return c.body(stored.body, stored.status as 200, {
          'content-type': stored.contentType,
          'idempotent-replayed': 'true',
        });
      }
      await next();
      const response = c.res;
      if (response.status < 500) {
        const body = await response.clone().text();
        // The write happened; a failed store only loses the replay.
        await store
          .set<StoredResponse>(
            cacheKey,
            {
              fingerprint,
              status: response.status,
              contentType: response.headers.get('content-type') ?? 'application/json',
              body,
            },
            { ttl: IDEMPOTENCY_TTL_SECONDS },
          )
          .catch((error: unknown) => logger.warn({ err: error }, 'idempotency store failed'));
      }
    } finally {
      running.delete(cacheKey);
      done();
    }
  };
}
