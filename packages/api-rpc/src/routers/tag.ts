import { z } from 'zod';
import { scoped } from '../base.js';
import { assertOnType } from '../guards.js';
import { searchTerm, spaceItem, spaceScoped, uuid } from '../schemas.js';

/** One tag name as typed; the service trims it and derives the slug. */
const tagName = z.string().min(1).max(64);

/** The tags of one document or asset, in the order they are shown. */
const tagNames = z.array(tagName).max(50);

export const tagRouter = {
  /** The space's vocabulary, for the tag input's suggestions. */
  list: scoped('space:read')
    .input(spaceScoped.extend({ search: searchTerm.optional() }))
    .handler(async ({ input, context }) => context.tags.list(input.spaceId, input.search)),

  /** The vocabulary with usage counts, for the management screen. */
  listWithCounts: scoped('space:read')
    .input(spaceScoped.extend({ search: searchTerm.optional() }))
    .handler(async ({ input, context }) =>
      context.tags.listWithCounts(input.spaceId, input.search),
    ),

  /** The tags of several documents, keyed by document id. */
  ofContent: scoped('content:read')
    .input(spaceScoped.extend({ contentIds: z.array(uuid).max(200) }))
    .handler(async ({ input, context }) => {
      const rows = await context.content.storedMany(context.env, input.contentIds);
      const byGroup = await context.tags.ofContent(rows.map((row) => row.localizationId));
      return Object.fromEntries(rows.map((row) => [row.id, byGroup.get(row.localizationId) ?? []]));
    }),

  create: scoped('content:write')
    .input(spaceScoped.extend({ name: tagName }))
    .handler(async ({ input, context }) =>
      context.tags.create(input.spaceId, input.name, context.principal?.userId ?? null),
    ),

  rename: scoped('content:write')
    .input(spaceItem.extend({ name: tagName }))
    .handler(async ({ input, context }) =>
      context.tags.rename(input.spaceId, input.id, input.name),
    ),

  /** Moves everything tagged `sourceId` onto `targetId` and drops the source. */
  merge: scoped('content:write')
    .input(spaceScoped.extend({ sourceId: uuid, targetId: uuid }))
    .handler(async ({ input, context }) =>
      context.tags.merge(input.spaceId, input.sourceId, input.targetId),
    ),

  delete: scoped('content:write')
    .input(spaceItem)
    .handler(async ({ input, context }) => {
      await context.tags.delete(input.spaceId, input.id);
      return { ok: true };
    }),

  /** Replaces a document's tags; every translation of it carries the same ones. */
  setForContent: scoped('content:write')
    .input(spaceScoped.extend({ contentId: uuid, tags: tagNames }))
    .handler(async ({ input, context }) => {
      const row = await context.content.stored(context.env, input.contentId);
      if (!row) return [];
      // The document's own type decides who may write it.
      assertOnType(context, input.spaceId, 'content:write', row.typeId);
      return context.tags.setForContent(
        context.env,
        row.localizationId,
        input.tags,
        context.principal?.userId ?? null,
      );
    }),

  /** Replaces an asset's tags within this space; other spaces' tags stay. */
  setForAsset: scoped('asset:write')
    .input(spaceScoped.extend({ assetId: uuid, tags: tagNames }))
    .handler(async ({ input, context }) => {
      const asset = await context.media.get(input.spaceId, input.assetId);
      if (!asset) return [];
      return context.tags.setForAsset(
        input.spaceId,
        input.assetId,
        input.tags,
        context.principal?.userId ?? null,
      );
    }),
};
