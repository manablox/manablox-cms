import type { MaybeRefOrGetter } from 'vue';
import { toValue } from 'vue';
import { api } from '../../lib/api';
import { invalidate } from '../../lib/invalidate';
import { keys } from '../../lib/keys';
import { useSpaceQuery } from '../../lib/space-query';
import { spaceWrites } from '../../lib/writes';

export type { TagWithCounts } from '../../lib/api-types';

/** The space's vocabulary, for a tag input's suggestions. */
export function useTags(search: MaybeRefOrGetter<string> = '') {
  return useSpaceQuery(
    (space) => keys.tags.list(space, toValue(search)),
    (space) => {
      const term = toValue(search).trim();
      return api.tags.list({ spaceId: space, ...(term ? { search: term } : {}) });
    },
  );
}

/** The vocabulary with usage counts, for the management screen. */
export function useTagCounts(
  search: MaybeRefOrGetter<string> = '',
  options: { enabled?: MaybeRefOrGetter<boolean> } = {},
) {
  return useSpaceQuery(
    (space) => keys.tags.counts(space, toValue(search)),
    (space) => {
      const term = toValue(search).trim();
      return api.tags.listWithCounts({ spaceId: space, ...(term ? { search: term } : {}) });
    },
    options,
  );
}

/** The tags of the documents on screen, keyed by document id. */
export function useContentTags(contentIds: MaybeRefOrGetter<readonly string[]>) {
  return useSpaceQuery(
    (space) => keys.tags.ofContent(space, toValue(contentIds)),
    (space) => api.tags.ofContent({ spaceId: space, contentIds: [...toValue(contentIds)] }),
    { enabled: () => toValue(contentIds).length > 0 },
  );
}

const write = spaceWrites(invalidate.tags);

export const tags = {
  create: write.withSpace((spaceId: string, name: string) => api.tags.create({ spaceId, name })),
  rename: write.withSpace((spaceId: string, id: string, name: string) =>
    api.tags.rename({ spaceId, id, name }),
  ),
  merge: write.withSpace((spaceId: string, sourceId: string, targetId: string) =>
    api.tags.merge({ spaceId, sourceId, targetId }),
  ),
  remove: write.withSpace((spaceId: string, id: string) => api.tags.delete({ spaceId, id })),
  setForContent: write.withSpace((spaceId: string, contentId: string, names: string[]) =>
    api.tags.setForContent({ spaceId, contentId, tags: names }),
  ),
  setForAsset: write.withSpace((spaceId: string, assetId: string, names: string[]) =>
    api.tags.setForAsset({ spaceId, assetId, tags: names }),
  ),
};
