import { keepPreviousData } from '@tanstack/vue-query';
import { computed, type MaybeRefOrGetter, toValue } from 'vue';
import { useSpacePagedQuery } from '../../composables/usePagedQuery';
import { api } from '../../lib/api';
import { invalidate } from '../../lib/invalidate';
import { keys } from '../../lib/keys';
import {
  nextOffset,
  required,
  type SpaceRef,
  useSpaceInfiniteQuery,
  useSpaceQuery,
} from '../../lib/space-query';
import { spaceWrites } from '../../lib/writes';

export type { ContentDocument } from '../../lib/api-types';

/** Nodes per page within one tree level; more load on scroll. */
const TREE_PAGE_SIZE = 50;

/** One tree level, paged. Each level (root, or a node's children on expand) is its own query. */
export function useTreeChildren(
  locale: MaybeRefOrGetter<string>,
  parentId: MaybeRefOrGetter<string | null>,
  spaceId?: SpaceRef,
) {
  return useSpaceInfiniteQuery(
    (space) => keys.content.tree(space, toValue(locale), toValue(parentId)),
    (space, offset) =>
      api.content.treeChildren({
        spaceId: space,
        locale: toValue(locale),
        parentId: toValue(parentId),
        pagination: { limit: TREE_PAGE_SIZE, offset },
      }),
    { spaceId, getNextPageParam: nextOffset },
  );
}

/** A document's ancestors, root first, so the tree can reveal the open document. */
export function useContentAncestors(
  contentId: MaybeRefOrGetter<string | null>,
  spaceId?: SpaceRef,
) {
  return useSpaceQuery(
    (space) => keys.content.ancestors(space, toValue(contentId)),
    (space) => api.content.ancestors({ spaceId: space, id: required(toValue(contentId)) }),
    { spaceId, enabled: () => Boolean(toValue(contentId)) },
  );
}

/** Full-text search over a space's documents, from two characters on. */
export function useContentSearch(
  locale: MaybeRefOrGetter<string>,
  term: MaybeRefOrGetter<string>,
  tagIds: MaybeRefOrGetter<readonly string[]> = [],
  spaceId?: SpaceRef,
) {
  const tags = () => [...toValue(tagIds)];
  return useSpaceQuery(
    (space) => keys.content.search(space, toValue(locale), toValue(term), tags()),
    (space) =>
      api.content.list({
        filter: {
          spaceId: space,
          locale: toValue(locale),
          ...(toValue(term) ? { search: toValue(term) } : {}),
          ...(tags().length ? { tagIds: tags() } : {}),
        },
        pagination: { limit: 50, offset: 0 },
      }),
    // Either a search term or a tag narrows the list; without both there is nothing to show.
    { spaceId, enabled: () => toValue(term).length > 1 || tags().length > 0 },
  );
}

/** The most recently updated documents, with the total for the dashboard's count. */
export function useRecentContent(locale: MaybeRefOrGetter<string>, spaceId?: SpaceRef) {
  return useSpaceQuery(
    (space) => keys.content.recent(space, toValue(locale)),
    (space) =>
      api.content.list({
        filter: { spaceId: space, locale: toValue(locale) },
        pagination: { limit: 5, offset: 0 },
        sort: [{ by: 'updatedAt', direction: 'desc' }],
      }),
    { spaceId },
  );
}

/** Documents by id, for a relation field's chips. */
export function useContentByIds(ids: MaybeRefOrGetter<readonly string[]>, spaceId?: SpaceRef) {
  return useSpaceQuery(
    (space) => keys.content.byIds(space, toValue(ids)),
    async (space) => {
      // One request, in the field's order, `null` for a missing document.
      const wanted = [...toValue(ids)];
      const page = await api.content.list({
        filter: { spaceId: space, ids: wanted },
        pagination: { limit: Math.min(200, Math.max(1, wanted.length)), offset: 0 },
      });
      const byId = new Map(page.items.map((row) => [row.id, row]));
      return wanted.map((id) => byId.get(id) ?? null);
    },
    { spaceId, enabled: () => toValue(ids).length > 0 },
  );
}

/** What a `filter` relation field currently matches: a read-only preview built like the server's query. */
export function useRelationPreview(
  locale: MaybeRefOrGetter<string>,
  settings: MaybeRefOrGetter<Record<string, unknown>>,
  enabled: MaybeRefOrGetter<boolean>,
  spaceId?: SpaceRef,
) {
  const query = computed(() => {
    const raw = toValue(settings);
    const types = Array.isArray(raw.types) ? (raw.types as string[]) : [];
    const under = typeof raw.under === 'string' ? raw.under : '';
    const search = typeof raw.search === 'string' ? raw.search.trim() : '';
    const limit = Number(raw.limit);
    const offset = Number(raw.offset);
    return {
      typeIds: types,
      under,
      search,
      limit: Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.trunc(limit))) : 10,
      offset: Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0,
      by: typeof raw.sortBy === 'string' ? raw.sortBy : 'position',
      direction: raw.sortDirection === 'desc' ? ('desc' as const) : ('asc' as const),
    };
  });

  return useSpaceQuery(
    (space) => keys.content.relationPreview(space, toValue(locale), query.value),
    (space) => {
      const q = query.value;
      return api.content.list({
        filter: {
          spaceId: space,
          locale: toValue(locale),
          ...(q.typeIds.length ? { typeIds: q.typeIds } : {}),
          ...(q.under ? { under: q.under } : {}),
          ...(q.search ? { search: q.search } : {}),
        },
        pagination: { limit: q.limit, offset: q.offset },
        sort: [{ by: q.by as 'position', direction: q.direction }],
      });
    },
    { spaceId, enabled },
  );
}

/** Candidate documents for a relation picker, only while it is open. */
export function useContentPicker(
  locale: MaybeRefOrGetter<string>,
  term: MaybeRefOrGetter<string>,
  typeIds: MaybeRefOrGetter<readonly string[]>,
  enabled: MaybeRefOrGetter<boolean>,
  spaceId?: SpaceRef,
) {
  return useSpaceQuery(
    (space) => keys.content.picker(space, toValue(locale), toValue(term), toValue(typeIds)),
    (space) => {
      const types = toValue(typeIds);
      const search = toValue(term);
      return api.content.list({
        filter: {
          spaceId: space,
          locale: toValue(locale),
          ...(search ? { search } : {}),
          ...(types.length ? { typeIds: [...types] } : {}),
        },
        pagination: { limit: 20, offset: 0 },
      });
    },
    { spaceId, enabled },
  );
}

/** Tree documents matching `term`, with their ancestors; idle while the term is blank. */
export function useTreeSearch(
  locale: MaybeRefOrGetter<string>,
  term: MaybeRefOrGetter<string>,
  typeIds: MaybeRefOrGetter<readonly string[]> = [],
  spaceId?: SpaceRef,
) {
  return useSpaceQuery(
    (space) =>
      keys.content.treeSearch(space, toValue(locale), toValue(term).trim(), toValue(typeIds)),
    (space) => {
      const types = toValue(typeIds);
      return api.content.treeSearch({
        spaceId: space,
        locale: toValue(locale),
        search: toValue(term).trim(),
        ...(types.length ? { typeIds: [...types] } : {}),
      });
    },
    // The last result stays while the next term loads.
    { spaceId, enabled: () => toValue(term).trim().length > 0, placeholderData: keepPreviousData },
  );
}

/** The space's content templates: documents of the system template type, whose id the caller passes. */
export function useTemplates(
  locale: MaybeRefOrGetter<string>,
  typeId: MaybeRefOrGetter<string | null>,
  spaceId?: SpaceRef,
) {
  return useSpaceQuery(
    (space) => keys.content.templates(space, toValue(locale)),
    (space) =>
      api.content.list({
        filter: { spaceId: space, locale: toValue(locale), typeIds: [required(toValue(typeId))] },
        pagination: { limit: 200, offset: 0 },
        sort: [{ by: 'title', direction: 'asc' }],
      }),
    { spaceId, enabled: () => Boolean(toValue(typeId)) },
  );
}

export function useTranslations(contentId: MaybeRefOrGetter<string>, spaceId?: SpaceRef) {
  return useSpaceQuery(
    (space) => keys.content.translations(space, toValue(contentId)),
    (space) => api.content.translations({ spaceId: space, id: toValue(contentId) }),
    { spaceId },
  );
}

/** Versions per page of a document's history. */
export const VERSIONS_PAGE_SIZE = 20;

/** A document's versions, newest first, one page at a time. */
export function useVersions(contentId: MaybeRefOrGetter<string>, spaceId?: SpaceRef) {
  return useSpacePagedQuery(
    (space, page) => keys.content.versionPage(space, toValue(contentId), page),
    (space, pagination) =>
      api.content.versions({ spaceId: space, id: toValue(contentId), pagination }),
    { spaceId, pageSize: VERSIONS_PAGE_SIZE, resetOn: [() => toValue(contentId)] },
  );
}

/** Where a document stands in review, for the editor's approval panel. */
export function useApproval(
  contentId: MaybeRefOrGetter<string | null>,
  enabled: MaybeRefOrGetter<boolean> = true,
  spaceId?: SpaceRef,
) {
  return useSpaceQuery(
    (space) => keys.content.approval(space, toValue(contentId)),
    (space) => api.content.approval({ spaceId: space, id: required(toValue(contentId)) }),
    { spaceId, enabled: () => Boolean(toValue(contentId)) && toValue(enabled) },
  );
}

/** Review queue rows the dashboard shows before `Show more`. */
const APPROVALS_PAGE_SIZE = 10;

/** The open requests the caller may decide on, paged. */
export function usePendingApprovals(enabled: MaybeRefOrGetter<boolean> = true, spaceId?: SpaceRef) {
  return useSpaceInfiniteQuery(
    keys.content.pendingApprovals,
    (space, offset) =>
      api.content.pendingApprovals({
        spaceId: space,
        pagination: { limit: APPROVALS_PAGE_SIZE, offset },
      }),
    { spaceId, enabled, getNextPageParam: nextOffset },
  );
}

const write = spaceWrites(invalidate.content);

type CreateInput = Parameters<typeof api.content.create>[0];
type UpdateInput = Parameters<typeof api.content.update>[0];

/** A typed tag is created by the save. */
function tagsWritten(input: { spaceId: string; tags?: string[] | undefined }): void {
  if (input.tags?.length) invalidate.tagVocabulary(input.spaceId);
}

/** Review actions; each invalidates the queue and the editor. */
export const approvals = {
  request: write.withSpace((spaceId: string, id: string, note: string | null) =>
    api.content.requestApproval({ spaceId, id, ...(note ? { note } : {}) }),
  ),
  withdraw: write.withSpace((spaceId: string, id: string) =>
    api.content.withdrawApproval({ spaceId, id }),
  ),
  approve: write.withSpace((spaceId: string, id: string, note: string | null) =>
    api.content.approve({ spaceId, id, ...(note ? { note } : {}) }),
  ),
  reject: write.withSpace((spaceId: string, id: string, note: string | null) =>
    api.content.reject({ spaceId, id, ...(note ? { note } : {}) }),
  ),
};

/** Content writes outside the draft store, each with its invalidation. */
export const content = {
  invalidate(spaceId: string): void {
    invalidate.content(spaceId);
  },
  /** One document; `null` when it is gone. */
  get(spaceId: string, id: string) {
    return api.content.get({ spaceId, id });
  },
  /** A whole new document, from the editor or e.g. a designed template. */
  create: write.withInput(async (input: CreateInput) => {
    const created = await api.content.create(input);
    tagsWritten(input);
    return created;
  }),
  /** The editor's save; `expectedVersion` rejects a write built on a stale version. */
  update: write.withInput(async (input: UpdateInput) => {
    const saved = await api.content.update(input);
    tagsWritten(input);
    return saved;
  }),
  /** Field values with defaults filled in - what a new document starts from. */
  blank(spaceId: string, typeId: string) {
    return api.content.blank({ spaceId, typeId });
  },
  /** The tree marks published documents. */
  publish: write.withSpace(async (spaceId: string, id: string) => {
    await api.content.publish({ spaceId, id });
  }),
  unpublish: write.withSpace(async (spaceId: string, id: string) => {
    await api.content.unpublish({ spaceId, id });
  }),
  /** Both ends of the publishing window; `null` clears one. */
  schedule: write.withSpace(
    (spaceId: string, id: string, window: { publishAt: Date | null; unpublishAt: Date | null }) =>
      api.content.schedule({ spaceId, id, ...window }),
  ),
  /**
   * A draft copy beside the original, returned so the caller can open it.
   * `children` copies the subtree below it as well.
   */
  duplicate: write.withSpace(
    (spaceId: string, id: string, children: boolean): Promise<{ id: string; title: string }> =>
      api.content.duplicate({ spaceId, id, children }),
  ),
  /** How many tree children a document has, for the prompts that depend on it. */
  async childCount(spaceId: string, locale: string, parentId: string) {
    const page = await api.content.treeChildren({
      spaceId,
      locale,
      parentId,
      pagination: { limit: 1, offset: 0 },
    });
    return page.total;
  },
  /** Deletes a document; `cascade` deletes its children, `reparent` moves them up. */
  remove: write.withSpace(
    async (spaceId: string, id: string, children: 'cascade' | 'reparent' = 'cascade') => {
      await api.content.delete({ spaceId, id, children });
    },
  ),
  move: write.withSpace(
    async (spaceId: string, id: string, parentId: string | null, position: number) => {
      await api.content.move({ spaceId, id, parentId, position });
    },
  ),
  /** A tree folder, created in every locale of the space. */
  createFolder: write.withSpace(
    (spaceId: string, locale: string, title: string, parentId: string | null) =>
      api.content.createFolder({ spaceId, locale, title, parentId }),
  ),
  createTranslation: write.withSpace((spaceId: string, id: string, locale: string) =>
    api.content.createTranslation({ spaceId, id, locale }),
  ),
  restore: write.withSpace(async (spaceId: string, id: string, version: number) => {
    await api.content.restore({ spaceId, id, version });
  }),
};
