import { useSpacePagedQuery } from '@manablox/admin-sdk/composables/usePagedQuery';
import { api } from '@manablox/admin-sdk/lib/api';
import { keys } from '@manablox/admin-sdk/lib/keys';
import { type SpaceRef, useSpaceQuery } from '@manablox/admin-sdk/lib/space-query';
import { type MaybeRefOrGetter, toValue } from 'vue';

/** Rows per page of a databag's table. */
export const DATABAG_PAGE_SIZE = 25;

export type DatabagSort = { by: 'title' | 'updatedAt' | 'createdAt'; direction: 'asc' | 'desc' };

export interface DatabagQuery {
  search: string;
  sort: DatabagSort;
}

/** One page of a databag's entries in a locale, searched and sorted; any change starts at the first page. */
export function useDatabagEntries(
  typeId: MaybeRefOrGetter<string>,
  locale: MaybeRefOrGetter<string>,
  query: MaybeRefOrGetter<DatabagQuery>,
  spaceId?: SpaceRef,
) {
  return useSpacePagedQuery(
    (space, page) =>
      keys.content.databag(space, toValue(typeId), toValue(locale), { ...toValue(query), page }),
    (space, pagination) => {
      const { search, sort } = toValue(query);
      return api.content.list({
        filter: {
          spaceId: space,
          locale: toValue(locale),
          typeIds: [toValue(typeId)],
          ...(search ? { search } : {}),
        },
        pagination,
        sort: [sort],
      });
    },
    {
      spaceId,
      pageSize: DATABAG_PAGE_SIZE,
      resetOn: [
        () => toValue(query).search,
        () => toValue(query).sort.by,
        () => toValue(query).sort.direction,
        () => toValue(typeId),
        () => toValue(locale),
      ],
      enabled: () => Boolean(toValue(typeId)),
      // Only the same databag's previous page stays on screen while the next one loads.
      placeholderData: (previous, previousQuery) =>
        previousQuery?.queryKey[4] === toValue(typeId) ? previous : undefined,
    },
  );
}

/** Entry counts per databag type, for the landing page's cards. */
export function useDatabagCounts(
  locale: MaybeRefOrGetter<string>,
  typeIds: MaybeRefOrGetter<readonly string[]>,
  spaceId?: SpaceRef,
) {
  return useSpaceQuery(
    (space) => keys.content.databagCounts(space, toValue(locale), toValue(typeIds)),
    async (space) => {
      const counts = await Promise.all(
        toValue(typeIds).map(async (typeId) => {
          const page = await api.content.list({
            filter: { spaceId: space, locale: toValue(locale), typeIds: [typeId] },
            pagination: { limit: 1, offset: 0 },
          });
          return [typeId, page.total] as const;
        }),
      );
      return Object.fromEntries(counts) as Record<string, number>;
    },
    { spaceId, enabled: () => toValue(typeIds).length > 0 },
  );
}
