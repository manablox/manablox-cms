import type { QueryKey } from '@tanstack/vue-query';
import { queryClient } from './query-client';

/** Writes that end by invalidating one space's queries. */
export function spaceWrites(invalidateSpace: (spaceId: string) => void | Promise<void>) {
  const done = async <R>(spaceId: string, result: R): Promise<R> => {
    await invalidateSpace(spaceId);
    return result;
  };
  return {
    /** A write whose first argument is the space id. */
    withSpace<A extends [string, ...unknown[]], R>(call: (...args: A) => Promise<R>) {
      return async (...args: A): Promise<R> => done(args[0], await call(...args));
    },
    /** A write whose input carries `spaceId`. */
    withInput<I extends { spaceId: string }, R>(call: (input: I) => Promise<R>) {
      return async (input: I): Promise<R> => done(input.spaceId, await call(input));
    },
  };
}

/** Writes that end by running one invalidation. */
export function writes(invalidateAll: () => void | Promise<void>) {
  return <A extends unknown[], R>(call: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      const result = await call(...args);
      await invalidateAll();
      return result;
    };
}

/** Rewrites every cached query under `queryKey` at once; resolves to the rollback. */
export async function optimistic<T>(
  queryKey: QueryKey,
  update: (data: T, key: QueryKey) => T,
): Promise<() => void> {
  // An in-flight fetch would land over the edit.
  await queryClient.cancelQueries({ queryKey });
  const before = queryClient.getQueriesData<T>({ queryKey });
  for (const [key, data] of before) {
    if (data !== undefined) queryClient.setQueryData<T>(key, update(data, key));
  }
  return () => {
    for (const [key, data] of before) queryClient.setQueryData(key, data);
  };
}
