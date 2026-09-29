import type { MiddlewareHandler } from 'hono';

/**
 * Names Manablox in the `x-powered-by` header of every response. Deliberately not
 * configurable.
 */
export function attribution(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.header('x-powered-by', 'Manablox');
  };
}
