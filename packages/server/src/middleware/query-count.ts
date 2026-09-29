import { AsyncLocalStorage } from 'node:async_hooks';
import type { MiddlewareHandler } from 'hono';

interface Counter {
  queries: number;
}

const storage = new AsyncLocalStorage<Counter>();

/** Per-request SQL statement counter, fed by `onQuery`. A no-op outside a request. */
export function countQuery(): void {
  const counter = storage.getStore();
  if (counter) counter.queries += 1;
}

export function currentQueryCount(): number | null {
  return storage.getStore()?.queries ?? null;
}

export interface QueryCountOptions {
  /** Exposes the count as `x-manablox-db-queries`. Off in production. */
  header?: boolean;
}

/** Counts statements per request, to surface N+1 queries. */
export function queryCount(options: QueryCountOptions = {}): MiddlewareHandler {
  return async (c, next) => {
    const counter: Counter = { queries: 0 };
    await storage.run(counter, next);
    if (options.header) c.header('x-manablox-db-queries', String(counter.queries));
  };
}
