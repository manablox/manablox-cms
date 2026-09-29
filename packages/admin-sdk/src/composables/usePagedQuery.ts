import {
  keepPreviousData,
  type QueryKey,
  type QueryObserverOptions,
  type UseQueryReturnType,
  useQuery,
} from '@tanstack/vue-query';
import {
  type ComputedRef,
  computed,
  type MaybeRefOrGetter,
  type Ref,
  ref,
  toValue,
  type WatchSource,
  watch,
} from 'vue';
import { queryClient } from '../lib/query-client';
import { useSpaceScope } from '../lib/space-query';

/** The `pagination` input of a list procedure. */
export interface PageRequest {
  limit: number;
  offset: number;
}

type Extras<TPage> = Pick<
  QueryObserverOptions<TPage, Error, TPage, TPage, QueryKey>,
  'staleTime' | 'refetchOnMount' | 'refetchInterval'
>;

export interface PagedQueryOptions<TPage> extends Extras<TPage> {
  pageSize: number;
  /** The key of one page; `page` counts from 0. */
  queryKey: (page: number) => QueryKey;
  queryFn: (pagination: PageRequest) => Promise<TPage>;
  /** Changes that send the pager back to the first page. */
  resetOn?: WatchSource[];
  enabled?: MaybeRefOrGetter<boolean>;
  /** What shows while a page loads; the previous page by default. */
  placeholderData?: (
    previous: NoInfer<TPage> | undefined,
    previousQuery: { queryKey: QueryKey } | undefined,
  ) => NoInfer<TPage> | undefined;
}

export type PagedQuery<TPage> = UseQueryReturnType<TPage, Error> & {
  /** The shown page, from 0; bind it to `Pager`. */
  page: Ref<number>;
  total: ComputedRef<number>;
  /** The server stopped counting at a cap: there are more than `total`. */
  capped: ComputedRef<boolean>;
  pages: ComputedRef<number>;
  pageSize: number;
};

/**
 * One page of a paged list at a time. Keeps the shown page while the next loads, returns to
 * the first page on `resetOn`, and steps back when the total shrinks past the page.
 */
export function usePagedQuery<TPage extends { total: number; capped?: boolean | undefined }>(
  options: PagedQueryOptions<TPage>,
): PagedQuery<TPage> {
  const { pageSize, queryKey, queryFn, resetOn, enabled, placeholderData, ...extras } = options;
  const page = ref(0);
  if (resetOn?.length) {
    watch(resetOn, () => {
      page.value = 0;
    });
  }
  const query = useQuery<TPage, Error, TPage, QueryKey>(
    {
      ...extras,
      // vue-query's placeholder type does not narrow through a generic page.
      placeholderData: (placeholderData ?? keepPreviousData) as never,
      queryKey: computed(() => queryKey(page.value)),
      enabled: computed(() => toValue(enabled) !== false),
      queryFn: () => queryFn({ limit: pageSize, offset: page.value * pageSize }),
    },
    queryClient,
  );
  const total = computed(() => query.data.value?.total ?? 0);
  const capped = computed(() => query.data.value?.capped === true);
  const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
  watch(pages, (count) => {
    if (page.value >= count) page.value = count - 1;
  });
  return Object.assign(query, { page, total, capped, pages, pageSize });
}

export interface SpacePagedQueryOptions<TPage>
  extends Omit<PagedQueryOptions<TPage>, 'queryKey' | 'queryFn'> {
  /** The space to read; the store's current space when absent. */
  spaceId?: MaybeRefOrGetter<string | null> | undefined;
}

/** `usePagedQuery` gated like `useSpaceQuery`; a new space starts at the first page. */
export function useSpacePagedQuery<TPage extends { total: number; capped?: boolean | undefined }>(
  key: (spaceId: string | null, page: number) => QueryKey,
  fn: (spaceId: string, pagination: PageRequest) => Promise<TPage>,
  options: SpacePagedQueryOptions<TPage>,
): PagedQuery<TPage> {
  const { spaceId, enabled, resetOn = [], ...rest } = options;
  const scope = useSpaceScope({ spaceId, enabled });
  return usePagedQuery({
    ...rest,
    resetOn: [...resetOn, scope.spaceId],
    queryKey: (page) => key(scope.spaceId.value, page),
    queryFn: (pagination) => fn(scope.required(), pagination),
    enabled: scope.enabled,
  });
}
