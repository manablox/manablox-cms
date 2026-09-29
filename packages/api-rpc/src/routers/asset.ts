import { assertCan } from '@manablox/auth';
import {
  ASSET_ADJUSTMENT_RANGES,
  ASSET_EFFECTS,
  ASSET_ROTATIONS,
  type AssetImageEdits,
  ManabloxError,
} from '@manablox/core';
import type { AssetRow } from '@manablox/db';
import { z } from 'zod';
import { scoped } from '../base.js';
import type { RpcContext } from '../context.js';
import { pagination, scheduleAt, searchTerm, spaceItem, spaceScoped, uuid } from '../schemas.js';

const range = (key: keyof typeof ASSET_ADJUSTMENT_RANGES) =>
  z.number().min(ASSET_ADJUSTMENT_RANGES[key].min).max(ASSET_ADJUSTMENT_RANGES[key].max).optional();

const imageEdits = z.object({
  crop: z
    .object({
      left: z.number().int().min(0),
      top: z.number().int().min(0),
      width: z.number().int().min(1),
      height: z.number().int().min(1),
    })
    .nullable()
    .optional(),
  focalPoint: z
    .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
    .nullable()
    .optional(),
  rotate: z
    .union(ASSET_ROTATIONS.map((turn) => z.literal(turn)))
    .nullable()
    .optional(),
  flipHorizontal: z.boolean().nullable().optional(),
  flipVertical: z.boolean().nullable().optional(),
  adjust: z
    .object({
      brightness: range('brightness'),
      saturation: range('saturation'),
      contrast: range('contrast'),
      hue: range('hue'),
    })
    .nullable()
    .optional(),
  effect: z.enum(ASSET_EFFECTS).nullable().optional(),
}) satisfies z.ZodType<AssetImageEdits>;

/** Assets with URLs, their spaces and the tags `spaceId` gives them. */
async function present(context: RpcContext, spaceId: string, rows: AssetRow[]) {
  const ids = rows.map((row) => row.id);
  const [spaceIds, tags] = await Promise.all([
    context.media.spaceIdsOf(ids),
    context.tags.ofAssets(ids, spaceId),
  ]);
  return rows.map((row) => ({
    ...context.media.present(row),
    spaceIds: spaceIds.get(row.id) ?? [],
    tags: tags.get(row.id) ?? [],
  }));
}

const presentOne = async (context: RpcContext, spaceId: string, row: AssetRow) =>
  (await present(context, spaceId, [row]))[0] as Awaited<ReturnType<typeof present>>[number];

export const assetRouter = {
  /** The space's upload limits and the instance ceiling. */
  limits: scoped('asset:read')
    .input(spaceScoped)
    .handler(async ({ input, context }) => context.media.limits(input.spaceId)),

  /** The instance's rendition presets: names and measurements. */
  presets: scoped('asset:read')
    .input(spaceScoped)
    .handler(async ({ context }) =>
      Object.entries(context.manablox.config.media.presets ?? {}).map(([name, preset]) => ({
        name,
        width: preset.width ?? null,
        height: preset.height ?? null,
        fit: preset.fit ?? 'inside',
        format: preset.format ?? 'webp',
      })),
    ),

  list: scoped('asset:read')
    .input(
      spaceScoped.extend({
        pagination: pagination({ limit: 40, max: 100 }),
        /** Mime type prefix to keep, e.g. `image/`. */
        mimeType: z.string().max(100).optional(),
        /** Mime type prefixes to leave out. */
        mimeTypeNot: z.array(z.string().min(1).max(100)).max(10).optional(),
        search: searchTerm.optional(),
        /** Tag ids; an asset carrying any of them is kept. */
        tagIds: z.array(uuid).max(20).optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const page = await context.media.list(
        {
          spaceId: input.spaceId,
          ...(input.mimeType ? { mimeType: input.mimeType } : {}),
          ...(input.mimeTypeNot?.length ? { mimeTypeNot: input.mimeTypeNot } : {}),
          ...(input.search ? { search: input.search } : {}),
          ...(input.tagIds?.length ? { tagIds: input.tagIds } : {}),
        },
        input.pagination,
      );
      return { ...page, items: await present(context, input.spaceId, page.items) };
    }),

  /** Several assets in one round trip; missing ids are absent. */
  getMany: scoped('asset:read')
    .input(spaceScoped.extend({ ids: z.array(uuid).max(200) }))
    .handler(async ({ input, context }) => {
      const rows = await context.media.getMany(input.spaceId, input.ids);
      return present(context, input.spaceId, rows);
    }),

  get: scoped('asset:read')
    .input(spaceItem)
    .handler(async ({ input, context }) => {
      const asset = await context.media.get(input.spaceId, input.id);
      return asset ? presentOne(context, input.spaceId, asset) : null;
    }),

  update: scoped('asset:write')
    .input(
      spaceItem.extend({
        name: z.string().max(200).optional(),
        alt: z.string().max(500).nullable().optional(),
        title: z.string().max(500).nullable().optional(),
        /** Replaces the asset's tags in this space; absent leaves them alone. */
        tags: z.array(z.string().min(1).max(64)).max(50).optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const { spaceId, id, tags, ...data } = input;
      const row = await context.media.update(spaceId, id, data);
      if (tags) {
        await context.tags.setForAsset(spaceId, id, tags, context.principal?.userId ?? null);
      }
      return presentOne(context, spaceId, row);
    }),

  /** The availability window. The media route checks it per request, even for published references. */
  schedule: scoped('asset:write')
    .input(
      spaceItem.extend({
        publishAt: scheduleAt,
        unpublishAt: scheduleAt,
      }),
    )
    .handler(async ({ input, context }) => {
      // Clearing a window stays allowed.
      if (input.publishAt || input.unpublishAt) {
        await context.manablox.controls.assertFeature(input.spaceId, 'scheduledPublishing');
      }
      const asset = await context.media.schedule(input.spaceId, input.id, {
        ...(input.publishAt !== undefined ? { publishAt: input.publishAt } : {}),
        ...(input.unpublishAt !== undefined ? { unpublishAt: input.unpublishAt } : {}),
      });
      return presentOne(context, input.spaceId, asset);
    }),

  /** Replaces the asset's spaces. Needs `asset:write` here and in every space added or removed. */
  setSpaces: scoped('asset:write')
    .input(spaceItem.extend({ spaceIds: z.array(uuid).min(1).max(100) }))
    .handler(async ({ input, context }) => {
      const before = (await context.media.spaceIdsOf([input.id])).get(input.id) ?? [];
      const changed = [
        ...input.spaceIds.filter((id) => !before.includes(id)),
        ...before.filter((id) => !input.spaceIds.includes(id)),
      ];
      for (const spaceId of changed) {
        try {
          assertCan(context.principal, spaceId, 'asset:write');
        } catch {
          throw ManabloxError.forbidden('asset.spaces.forbidden', { spaceId });
        }
      }
      await context.media.setSpaces(input.spaceId, input.id, input.spaceIds);
      // Removed from this space, so not shown here.
      const asset = await context.media.find(input.id);
      return asset ? presentOne(context, input.spaceId, asset) : null;
    }),

  /** Sets an image's whole edit; `null` or omitted clears a part. Variants re-render. */
  setImageEdits: scoped('asset:write')
    .input(imageEdits.extend(spaceItem.shape))
    .handler(async ({ input, context }) => {
      const asset = await context.media.setImageEdits(input.spaceId, input.id, {
        crop: input.crop ?? null,
        focalPoint: input.focalPoint ?? null,
        rotate: input.rotate ?? null,
        flipHorizontal: input.flipHorizontal ?? null,
        flipVertical: input.flipVertical ?? null,
        adjust: input.adjust ?? null,
        effect: input.effect ?? null,
      });
      return presentOne(context, input.spaceId, asset);
    }),

  /** Deletes from this space; `removed` says whether the asset itself went too. */
  delete: scoped('asset:delete')
    .input(spaceItem)
    .handler(async ({ input, context }) => {
      const { removed } = await context.media.delete(input.spaceId, input.id);
      return { ok: true, removed };
    }),
};
