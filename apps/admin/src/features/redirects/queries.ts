import { useSpacePagedQuery } from '@manablox/admin-sdk/composables/usePagedQuery';
import { api } from '@manablox/admin-sdk/lib/api';
import { invalidate } from '@manablox/admin-sdk/lib/invalidate';
import { keys } from '@manablox/admin-sdk/lib/keys';
import type { RedirectSource } from '@manablox/core';
import { type MaybeRefOrGetter, toValue } from 'vue';

export type Redirect = Awaited<ReturnType<typeof api.redirects.list>>['items'][number];

type RedirectInput = Omit<Parameters<typeof api.redirects.create>[0], 'spaceId'>;

export const REDIRECT_PAGE_SIZE = 50;

/** A page of the space's redirects, by old path. */
export function useRedirects(filter: {
  search: MaybeRefOrGetter<string>;
  source: MaybeRefOrGetter<RedirectSource | null>;
  locale: MaybeRefOrGetter<string | null>;
}) {
  return useSpacePagedQuery(
    (space, page) =>
      keys.redirects.page(space, {
        search: toValue(filter.search),
        source: toValue(filter.source),
        locale: toValue(filter.locale),
        page,
      }),
    (space, pagination) => {
      const search = toValue(filter.search).trim();
      const source = toValue(filter.source);
      const locale = toValue(filter.locale);
      return api.redirects.list({
        spaceId: space,
        ...(search ? { search } : {}),
        ...(source ? { source } : {}),
        ...(locale ? { locale } : {}),
        pagination,
      });
    },
    {
      pageSize: REDIRECT_PAGE_SIZE,
      resetOn: [
        () => toValue(filter.search),
        () => toValue(filter.source),
        () => toValue(filter.locale),
      ],
    },
  );
}

export const redirects = {
  async create(spaceId: string, input: RedirectInput) {
    const row = await api.redirects.create({ spaceId, ...input });
    invalidate.redirects(spaceId);
    return row;
  },
  async update(spaceId: string, id: string, input: RedirectInput) {
    const row = await api.redirects.update({ spaceId, id, ...input });
    invalidate.redirects(spaceId);
    return row;
  },
  async delete(spaceId: string, id: string) {
    await api.redirects.delete({ spaceId, id });
    invalidate.redirects(spaceId);
  },
};
