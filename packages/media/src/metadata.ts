import {
  type AssetImageEdits,
  type AuditChange,
  diffRecords,
  ManabloxError,
  snapshotChanges,
} from '@manablox/core';
import type { AssetRow } from '@manablox/db';
import type { AssetSchedule } from './availability.js';
import { ASSET_DIFF, type MediaContext } from './context.js';
import { rotatedSize, validateImageEdits } from './edits.js';

/** Image edits, metadata, space membership and deletion of stored assets. */
export class AssetMetadata {
  constructor(private readonly ctx: MediaContext) {}

  /** Stores the edits in `meta` (the original is kept) and drops the rendered variants. */
  async setImageEdits(spaceId: string, assetId: string, edits: AssetImageEdits): Promise<AssetRow> {
    const asset = await this.ctx.require(spaceId, assetId);
    if (!asset.mimeType.startsWith('image/') || !asset.width || !asset.height) {
      throw ManabloxError.badRequest('asset.notAnImage', { id: assetId });
    }

    // The crop is drawn on the rotated image.
    const valid = validateImageEdits(
      edits,
      rotatedSize({ width: asset.width, height: asset.height }, edits.rotate),
    );

    const meta = { ...asset.meta };
    for (const key of [
      'crop',
      'focalPoint',
      'rotate',
      'flipHorizontal',
      'flipVertical',
      'adjust',
      'effect',
    ] as const) {
      const value = valid[key];
      if (value === undefined || value === null) delete meta[key];
      else meta[key] = value;
    }

    await this.ctx.deleteFiles(
      assetId,
      (await this.ctx.repos.assets.listVariantsByAssets([assetId])).map((variant) => variant.key),
    );
    await this.ctx.repos.assets.deleteVariantsByAsset(assetId);

    const saved = await this.ctx.repos.assets.update(assetId, { meta });
    await this.ctx.audit.record(
      'asset.setImageEdits',
      { ...saved, spaceId },
      diffRecords(asset, saved, ASSET_DIFF),
    );
    await this.ctx.purgeCache(assetId, spaceId);
    return saved;
  }

  /** Updates the name, alt text and title, in every space the asset is in. */
  async update(
    spaceId: string,
    assetId: string,
    data: {
      name?: string | undefined;
      alt?: string | null | undefined;
      title?: string | null | undefined;
    },
  ): Promise<AssetRow> {
    const asset = await this.ctx.require(spaceId, assetId);
    const saved = await this.ctx.repos.assets.update(assetId, data);
    await this.ctx.audit.record(
      'asset.update',
      { ...saved, spaceId },
      diffRecords(asset, saved, ASSET_DIFF),
    );
    // Lists search the name, so a rename can add the asset to one.
    const listSpaceIds =
      saved.name !== asset.name
        ? ((await this.ctx.repos.assets.listSpaceIdsByAssets([assetId])).get(assetId) ?? [spaceId])
        : [];
    await this.ctx.purgeCache(assetId, spaceId, listSpaceIds);
    return saved;
  }

  /** Sets the availability window; an omitted end is kept, `null` clears it. */
  async schedule(spaceId: string, assetId: string, window: AssetSchedule): Promise<AssetRow> {
    const asset = await this.ctx.require(spaceId, assetId);

    const publishAt = window.publishAt === undefined ? asset.publishAt : window.publishAt;
    const unpublishAt = window.unpublishAt === undefined ? asset.unpublishAt : window.unpublishAt;
    if (publishAt && unpublishAt && unpublishAt <= publishAt) {
      throw ManabloxError.badRequest('asset.schedule.invalidWindow', {
        publishAt: publishAt.toISOString(),
        unpublishAt: unpublishAt.toISOString(),
      });
    }

    const saved = await this.ctx.repos.assets.update(assetId, { publishAt, unpublishAt });
    await this.ctx.audit.record(
      'asset.schedule',
      { ...saved, spaceId },
      diffRecords(asset, saved, ASSET_DIFF),
    );
    await this.ctx.purgeCache(assetId, spaceId);
    return saved;
  }

  /**
   * Puts the asset in exactly these spaces, audited in each one affected. The caller
   * checks permissions.
   */
  async setSpaces(spaceId: string, assetId: string, spaceIds: string[]): Promise<string[]> {
    const asset = await this.ctx.require(spaceId, assetId);
    const wanted = [...new Set(spaceIds)];
    if (wanted.length === 0) throw ManabloxError.badRequest('asset.spaces.required');

    const found = await this.ctx.repos.spaces.listByIds(wanted);
    const missing = wanted.find((id) => !found.some((space) => space.id === id));
    if (missing) throw ManabloxError.notFound('space.notFound', { spaceId: missing });

    const before = (await this.ctx.repos.assets.listSpaceIdsByAssets([assetId])).get(assetId) ?? [];
    await this.ctx.repos.assets.setSpaces(assetId, wanted);
    this.ctx.owners.forget(assetId);

    const changed = [spaceId, ...before, ...wanted].filter(
      (id, index, all) =>
        all.indexOf(id) === index &&
        (id === spaceId || before.includes(id) !== wanted.includes(id)),
    );
    const change: AuditChange[] = [{ path: 'spaceIds', from: before, to: wanted }];
    for (const id of changed) {
      await this.ctx.audit.record('asset.setSpaces', { ...asset, spaceId: id }, change);
    }
    await this.ctx.purgeCache(
      assetId,
      spaceId,
      wanted.filter((id) => !before.includes(id)),
    );
    return wanted;
  }

  /** Removes the asset from `spaceId`, purging it entirely once no space holds it. */
  async delete(spaceId: string, assetId: string): Promise<{ removed: 'space' | 'asset' }> {
    const asset = await this.ctx.repos.assets.findById(assetId, spaceId);
    if (!asset) return { removed: 'asset' };

    await this.ctx.repos.assets.removeFromSpace(assetId, spaceId);
    this.ctx.owners.forget(assetId);
    // Read after the removal, or two concurrent deletes could both only unlink.
    const remaining =
      (await this.ctx.repos.assets.listSpaceIdsByAssets([assetId])).get(assetId) ?? [];
    if (remaining.length > 0) {
      await this.ctx.audit.record('asset.removeFromSpace', { ...asset, spaceId }, [
        { path: 'spaceIds', from: [spaceId, ...remaining], to: remaining },
      ]);
      await this.ctx.purgeCache(assetId, spaceId);
      return { removed: 'space' };
    }

    const size = await this.purge(asset, [spaceId]);
    await this.ctx.audit.record(
      'asset.delete',
      { ...asset, spaceId },
      snapshotChanges(asset, 'deleted', ASSET_DIFF),
    );
    await this.ctx.purgeCache(assetId, spaceId);
    await this.ctx.deleted(assetId, [spaceId], size);
    return { removed: 'asset' };
  }

  /** Deletes assets in no space and their files, best effort. `asset:afterDelete` gets the original's size. */
  async purgeOrphaned(): Promise<number> {
    const orphans = await this.ctx.repos.assets.deleteOrphanedReturning();
    for (const asset of orphans) {
      this.ctx.owners.forget(asset.id);
      await this.ctx.deleteOriginal(asset, []);
      await this.ctx.deleted(asset.id, [], asset.size);
    }
    return orphans.length;
  }

  /** The record, its variants and the bytes; returns the bytes freed. */
  private async purge(asset: AssetRow, spaceIds: string[]): Promise<number> {
    const assetId = asset.id;
    const variants = await this.ctx.repos.assets.listVariantsByAssets([assetId]);
    await this.ctx.deleteFiles(
      assetId,
      variants.map((variant) => variant.key),
    );
    await this.ctx.deleteOriginal(asset, spaceIds);
    await this.ctx.repos.assets.delete(assetId);
    return variants.reduce((total, variant) => total + variant.size, asset.size);
  }
}
