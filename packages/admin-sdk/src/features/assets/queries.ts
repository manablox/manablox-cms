import {
  ASSET_EFFECTS,
  ASSET_ROTATIONS,
  type AssetAdjustments,
  type AssetCrop,
  type AssetEffect,
  type AssetImageEdits,
  type AssetRotation,
  type FocalPoint,
} from '@manablox/core';
import { computed, type MaybeRefOrGetter, toValue } from 'vue';
import { api } from '../../lib/api';
import { responseError } from '../../lib/api-errors';
import { invalidate } from '../../lib/invalidate';
import { keys } from '../../lib/keys';
import {
  nextOffset,
  type SpaceRef,
  useSpaceInfiniteQuery,
  useSpaceQuery,
} from '../../lib/space-query';
import { spaceWrites } from '../../lib/writes';

export type { Asset } from '../../lib/api-types';

/** Assets per page; the list endpoint allows no more. */
const ASSET_PAGE_SIZE = 100;

/** The library, a page at a time; the grid and the picker pull the next page as they scroll. */
export function useAssetsPaged(
  search: MaybeRefOrGetter<string>,
  options: {
    mimeType?: MaybeRefOrGetter<string | null>;
    /** Mime type prefixes to leave out. */
    mimeTypeNot?: MaybeRefOrGetter<readonly string[]>;
    tagIds?: MaybeRefOrGetter<readonly string[]>;
  } = {},
  spaceId?: SpaceRef,
) {
  const mimeType = () => toValue(options.mimeType) ?? null;
  const mimeTypeNot = () => [...(toValue(options.mimeTypeNot) ?? [])];
  const tagIds = () => [...(toValue(options.tagIds) ?? [])];
  return useSpaceInfiniteQuery(
    (space) =>
      keys.assets.list(space, {
        search: toValue(search),
        mimeType: mimeType(),
        tagIds: tagIds(),
        mimeTypeNot: mimeTypeNot(),
      }),
    (space, offset) => {
      const term = toValue(search);
      const mime = mimeType();
      const not = mimeTypeNot();
      const tags = tagIds();
      return api.assets.list({
        spaceId: space,
        ...(term ? { search: term } : {}),
        ...(mime ? { mimeType: mime } : {}),
        ...(not.length ? { mimeTypeNot: not } : {}),
        ...(tags.length ? { tagIds: tags } : {}),
        pagination: { limit: ASSET_PAGE_SIZE, offset },
      });
    },
    { spaceId, getNextPageParam: nextOffset },
  );
}

export function useAssetsByIds(ids: MaybeRefOrGetter<readonly string[]>, spaceId?: SpaceRef) {
  return useSpaceQuery(
    (space) => keys.assets.byIds(space, toValue(ids)),
    async (space) => {
      // One request, in the field's order, `null` for a missing asset.
      const wanted = [...toValue(ids)];
      const rows = await api.assets.getMany({ spaceId: space, ids: wanted });
      const byId = new Map(rows.map((row) => [row.id, row]));
      return wanted.map((id) => byId.get(id) ?? null);
    },
    { spaceId, enabled: () => toValue(ids).length > 0 },
  );
}

/** What a `filter` asset field currently matches. Like the server, only the first accepted mime family is used. */
export function useAssetRelationPreview(
  settings: MaybeRefOrGetter<Record<string, unknown>>,
  enabled: MaybeRefOrGetter<boolean>,
  spaceId?: SpaceRef,
) {
  const query = computed(() => {
    const raw = toValue(settings);
    const accept = Array.isArray(raw.accept) ? (raw.accept as string[]) : [];
    const search = typeof raw.search === 'string' ? raw.search.trim() : '';
    const limit = Number(raw.limit);
    const offset = Number(raw.offset);
    return {
      mimeType: accept[0] ?? '',
      search,
      limit: Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.trunc(limit))) : 10,
      offset: Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0,
    };
  });

  return useSpaceQuery(
    (space) => keys.assets.relationPreview(space, query.value),
    (space) => {
      const q = query.value;
      return api.assets.list({
        spaceId: space,
        ...(q.mimeType ? { mimeType: q.mimeType } : {}),
        ...(q.search ? { search: q.search } : {}),
        pagination: { limit: q.limit, offset: q.offset },
      });
    },
    { spaceId, enabled },
  );
}

/** The instance's configured renditions. */
export function useMediaPresets(spaceId?: SpaceRef) {
  return useSpaceQuery(keys.assets.presets, (id) => api.assets.presets({ spaceId: id }), {
    spaceId,
    // Changes only on deploy.
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** The space's upload limits and the instance's ceiling. */
export function useAssetLimits(spaceId?: SpaceRef) {
  return useSpaceQuery(keys.assets.limits, (id) => api.assets.limits({ spaceId: id }), { spaceId });
}

/** An asset's edits with every neutral value filled in, as the editor holds them. */
export interface ImageEditorState {
  crop: AssetCrop | null;
  focalPoint: FocalPoint | null;
  rotate: AssetRotation;
  flipHorizontal: boolean;
  flipVertical: boolean;
  adjust: Record<keyof AssetAdjustments, number>;
  effect: AssetEffect;
}

/** Reads an asset's image edits from `meta` as the server does; absent values are neutral. */
export function imageEditsOf(meta: Record<string, unknown> | null | undefined): ImageEditorState {
  const crop = meta?.crop as AssetCrop | undefined;
  const focalPoint = meta?.focalPoint as FocalPoint | undefined;
  const rotate = meta?.rotate as AssetRotation | undefined;
  const effect = meta?.effect as AssetEffect | undefined;
  const adjust = (meta?.adjust ?? {}) as Partial<AssetAdjustments>;
  const number = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

  return {
    crop: crop && typeof crop.width === 'number' ? crop : null,
    focalPoint: focalPoint && typeof focalPoint.x === 'number' ? focalPoint : null,
    rotate: rotate !== undefined && ASSET_ROTATIONS.includes(rotate) ? rotate : 0,
    flipHorizontal: meta?.flipHorizontal === true,
    flipVertical: meta?.flipVertical === true,
    adjust: {
      brightness: number(adjust.brightness, 1),
      contrast: number(adjust.contrast, 1),
      saturation: number(adjust.saturation, 1),
      hue: number(adjust.hue, 0),
    },
    effect: effect !== undefined && ASSET_EFFECTS.includes(effect) ? effect : 'none',
  };
}

/** The numbers in a `.accept` attribute: `image/` becomes `image/*`. */
export function acceptAttribute(allowed: readonly string[] | undefined): string | undefined {
  if (!allowed?.length) return undefined;
  return allowed.map((entry) => (entry.endsWith('/') ? `${entry}*` : entry)).join(',');
}

type AssetUpdate = Omit<Parameters<typeof api.assets.update>[0], 'spaceId' | 'id'>;

const write = spaceWrites(invalidate.assets);

export const assets = {
  update: write.withSpace(async (spaceId: string, id: string, data: AssetUpdate) => {
    const saved = await api.assets.update({ spaceId, id, ...data });
    // A tag typed into the panel is created by the save.
    if (data.tags?.length) invalidate.tagVocabulary(spaceId);
    return saved;
  }),
  /** The availability window; `null` clears one end. Enforced per request by the media route. */
  schedule: write.withSpace(
    (spaceId: string, id: string, window: { publishAt: Date | null; unpublishAt: Date | null }) =>
      api.assets.schedule({ spaceId, id, ...window }),
  ),
  /** Sets the asset's spaces, refreshing every library it joins or leaves. */
  async setSpaces(spaceId: string, id: string, spaceIds: string[], before: readonly string[]) {
    const saved = await api.assets.setSpaces({ spaceId, id, spaceIds });
    for (const touched of new Set([spaceId, ...before, ...spaceIds])) invalidate.assets(touched);
    return saved;
  },
  setImageEdits: write.withSpace((spaceId: string, id: string, edits: AssetImageEdits) =>
    api.assets.setImageEdits({ spaceId, id, ...edits }),
  ),
  /** Uploads via the multipart route, since oRPC carries JSON. */
  async upload(spaceId: string, file: File): Promise<{ id: string }> {
    const body = new FormData();
    body.append('file', file);
    const response = await fetch(`/upload/${spaceId}`, {
      method: 'POST',
      credentials: 'include',
      body,
    });
    if (!response.ok) throw await responseError(response);
    const asset = (await response.json()) as { id: string };
    invalidate.assets(spaceId);
    return asset;
  },
  /** Removes the asset from this space; `removed` is `asset` when no other space holds it, else `space`. */
  async remove(
    spaceId: string,
    id: string,
    spaceIds: readonly string[] = [],
  ): Promise<'space' | 'asset'> {
    const { removed } = await api.assets.delete({ spaceId, id });
    for (const touched of new Set([spaceId, ...spaceIds])) invalidate.assets(touched);
    return removed;
  },
  invalidate(spaceId: string): void {
    invalidate.assets(spaceId);
  },
};
