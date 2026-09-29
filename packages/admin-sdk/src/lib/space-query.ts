import {
  type InfiniteData,
  type QueryKey,
  type QueryObserverOptions,
  type UseInfiniteQueryReturnType,
  type UseQueryReturnType,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/vue-query';
import { type ComputedRef, computed, type MaybeRefOrGetter, toValue } from 'vue';
import { useSpaceStore } from '../stores/space';
import { queryClient } from './query-client';

/** A hook's space: a ref or getter, or absent for the store's current space. */
export type SpaceRef = MaybeRefOrGetter<string | null> | undefined;

/** The tuning a space query may pass through. */
type QueryExtras<TData> = Pick<
  QueryObserverOptions<TData, Error, TData, TData, QueryKey>,
  'staleTime' | 'gcTime' | 'refetchInterval' | 'refetchOnMount' | 'retry'
> & {
  /** What shows while the key's first fetch runs. */
  placeholderData?: (
    previous: NoInfer<TData> | undefined,
    previousQuery: { queryKey: QueryKey } | undefined,
  ) => NoInfer<TData> | undefined;
};

export interface SpaceQueryOptions<TData> extends QueryExtras<TData> {
  /** The space to read; the store's current space when absent. */
  spaceId?: MaybeRefOrGetter<string | null> | undefined;
  /** A further condition, on top of a space being selected. */
  enabled?: MaybeRefOrGetter<boolean> | undefined;
}

/** The store's current space; annotated so the store's type never feeds back into its own queries. */
function currentSpaceId(): string | null {
  return useSpaceStore().currentId;
}

export interface SpaceScope {
  spaceId: ComputedRef<string | null>;
  enabled: ComputedRef<boolean>;
  /** The id, for a fetch; throws without one. */
  required: () => string;
}

/** The space id and `enabled` gate shared by every space-scoped query. */
export function useSpaceScope(options: {
  spaceId?: MaybeRefOrGetter<string | null> | undefined;
  enabled?: MaybeRefOrGetter<boolean> | undefined;
}): SpaceScope {
  const explicit = options.spaceId;
  const spaceId = computed(
    () => (explicit === undefined ? currentSpaceId() : toValue(explicit)) ?? null,
  );
  const enabled = computed(() => Boolean(spaceId.value) && toValue(options.enabled) !== false);
  const required = (): string => {
    if (!spaceId.value) throw new Error('No space selected');
    return spaceId.value;
  };
  return { spaceId, enabled, required };
}

/**
 * A query of the current space (or `options.spaceId`), disabled until one is selected.
 * `key` sees the id or `null`; `fn` only ever runs with an id.
 */
export function useSpaceQuery<TData>(
  key: (spaceId: string | null) => QueryKey,
  fn: (spaceId: string) => Promise<TData>,
  options: SpaceQueryOptions<TData> = {},
): UseQueryReturnType<TData, Error> {
  const { spaceId: _spaceId, enabled: _enabled, placeholderData, ...extras } = options;
  const scope = useSpaceScope(options);
  return useQuery<TData, Error, TData, QueryKey>(
    {
      ...extras,
      // vue-query's placeholder type does not narrow through a generic.
      ...(placeholderData ? { placeholderData: placeholderData as never } : {}),
      queryKey: computed(() => key(scope.spaceId.value)),
      enabled: scope.enabled,
      queryFn: () => fn(scope.required()),
    },
    queryClient,
  );
}

export interface SpaceInfiniteQueryOptions<TPage> {
  spaceId?: MaybeRefOrGetter<string | null> | undefined;
  enabled?: MaybeRefOrGetter<boolean> | undefined;
  /** The next page's offset, or undefined when done. */
  getNextPageParam: (last: TPage) => number | undefined;
}

/** `useSpaceQuery` for a paged list; `fn` gets the page offset, starting at 0. */
export function useSpaceInfiniteQuery<TPage>(
  key: (spaceId: string | null) => QueryKey,
  fn: (spaceId: string, offset: number) => Promise<TPage>,
  options: SpaceInfiniteQueryOptions<TPage>,
): UseInfiniteQueryReturnType<InfiniteData<TPage>, Error> {
  const scope = useSpaceScope(options);
  return useInfiniteQuery<TPage, Error, InfiniteData<TPage>, QueryKey, number>(
    {
      queryKey: computed(() => key(scope.spaceId.value)),
      enabled: scope.enabled,
      initialPageParam: 0,
      queryFn: ({ pageParam }) => fn(scope.required(), pageParam),
      getNextPageParam: options.getNextPageParam,
    },
    queryClient,
  );
}

/** A query input its `enabled` gate already guarantees; throws without one. */
export function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Query ran without its input');
  return value;
}

/** The next page's offset, or undefined when done. */
export const nextOffset = <T>(last: { offset: number; total: number; items: T[] }) => {
  const loaded = last.offset + last.items.length;
  return loaded < last.total ? loaded : undefined;
};
