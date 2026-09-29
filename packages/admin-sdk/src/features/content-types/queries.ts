import { isDocumentType } from '@manablox/core';
import { useQuery } from '@tanstack/vue-query';
import { computed, type MaybeRefOrGetter, toValue } from 'vue';
import { api } from '../../lib/api';
import type { ContentTypeSummary, FieldTypeMeta } from '../../lib/api-types';
import { invalidate } from '../../lib/invalidate';
import { keys } from '../../lib/keys';
import { queryClient } from '../../lib/query-client';
import { type SpaceRef, useSpaceQuery } from '../../lib/space-query';
import { spaceWrites } from '../../lib/writes';

export type { ContentTypeSummary, FieldDefinition, FieldTypeMeta } from '../../lib/api-types';

/** A space's content types. The space store reads the same cache synchronously, so both stay in step. */
export function useContentTypes(spaceId?: SpaceRef) {
  return useSpaceQuery(keys.contentTypes.list, (id) => api.contentTypes.list({ spaceId: id }), {
    spaceId,
  });
}

/** The field-type catalogue from the server's registry, plugin types included. */
export function useFieldTypes() {
  return useQuery(
    {
      queryKey: keys.contentTypes.fieldTypes(),
      queryFn: () => api.contentTypes.fieldTypes(),
      staleTime: Number.POSITIVE_INFINITY,
    },
    queryClient,
  );
}

/** Loads (or reuses) a space's types outside a component. */
export function fetchContentTypes(spaceId: string): Promise<ContentTypeSummary[]> {
  return queryClient.fetchQuery({
    queryKey: keys.contentTypes.list(spaceId),
    queryFn: () => api.contentTypes.list({ spaceId }),
  });
}

export function fetchFieldTypes(): Promise<FieldTypeMeta[]> {
  return queryClient.fetchQuery({
    queryKey: keys.contentTypes.fieldTypes(),
    queryFn: () => api.contentTypes.fieldTypes(),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** Document types of several spaces, for an API key's grid. */
export function useDocumentTypesOf(spaceIds: MaybeRefOrGetter<readonly string[]>) {
  return useQuery({
    queryKey: computed(() => keys.contentTypes.many(toValue(spaceIds))),
    queryFn: async () => {
      const lists = await Promise.all(
        toValue(spaceIds).map(async (spaceId) => ({
          spaceId,
          types: await fetchContentTypes(spaceId),
        })),
      );
      return lists.flatMap(({ spaceId, types }) =>
        types.filter(isDocumentType).map((type) => ({ ...type, spaceId })),
      );
    },
  });
}

type CreateInput = Parameters<typeof api.contentTypes.create>[0];
type UpdateInput = Parameters<typeof api.contentTypes.update>[0];

const write = spaceWrites((spaceId) => invalidate.contentTypes(spaceId));

/** Type writes, each awaiting its invalidation. */
export const contentTypes = {
  create: write.withInput((input: CreateInput) => api.contentTypes.create(input)),
  update: write.withInput((input: UpdateInput) => api.contentTypes.update(input)),
  remove: write.withSpace(async (spaceId: string, id: string) => {
    await api.contentTypes.delete({ spaceId, id });
  }),
};
