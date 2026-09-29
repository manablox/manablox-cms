import { auditor, ManabloxError, type MediaConfig, purgeTags } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { AssetRow, Repositories } from '@manablox/db';
import type { StorageDriver } from '@manablox/storage';
import { AssetOwners } from './owners.js';
import type { MediaServiceOptions } from './types.js';

/** An asset as audited in one of its spaces. */
type SpaceAsset = AssetRow & { spaceId: string };

/** Audit diffs skip the immutable file fields. */
export const ASSET_DIFF = { expand: ['meta'], ignore: ['driver', 'key', 'checksum', 'actorId'] };

/** What the upload and edit halves of the media service share. */
export class MediaContext {
  /** Entries are per space, since an asset can be in several. */
  readonly audit;
  /** Owning spaces for metering; forgotten when an asset's spaces change. */
  readonly owners: AssetOwners;

  constructor(
    readonly repos: Repositories,
    readonly storage: StorageDriver,
    readonly config: MediaConfig & { signingSecret?: string },
    readonly options: MediaServiceOptions,
  ) {
    this.audit = auditor(repos, 'asset', (asset: SpaceAsset) => asset.name, {
      meta: (asset) => ({ mimeType: asset.mimeType, filename: asset.filename }),
    });
    this.owners = new AssetOwners((assetId) => repos.assets.ownerSpaceId(assetId));
  }

  get logger(): Manablox['logger'] | undefined {
    return this.options.manablox?.logger;
  }

  /** The asset if it is in `spaceId`, else not found. */
  async require(spaceId: string, assetId: string): Promise<AssetRow> {
    const asset = await this.repos.assets.findById(assetId, spaceId);
    if (!asset) throw ManabloxError.notFound('asset.notFound', { id: assetId });
    return asset;
  }

  /** Best effort: a file left behind only costs storage, so the write goes on. */
  async deleteFiles(assetId: string, keys: string[]): Promise<void> {
    await Promise.all(
      keys.map((key) =>
        this.storage
          .delete(key)
          .catch((err: unknown) =>
            this.logger?.warn({ err, assetId, key }, 'asset file not deleted'),
          ),
      ),
    );
  }

  /** Deletes a deleted asset's original unless `retainDeleted` keeps it; a failure deletes. */
  async deleteOriginal(asset: AssetRow, spaceIds: string[]): Promise<void> {
    const retain = this.options.retainDeleted;
    const kept = retain
      ? await retain({ id: asset.id, keys: [asset.key] }, spaceIds).catch((err: unknown) => {
          this.logger?.warn({ err, assetId: asset.id }, 'asset file not kept');
          return false;
        })
      : false;
    if (!kept) await this.deleteFiles(asset.id, [asset.key]);
  }

  /** `asset:afterDelete`, once the record is gone. */
  async deleted(id: string, spaceIds: string[], size: number): Promise<void> {
    const manablox = this.options.manablox;
    if (!manablox) return;
    await manablox.hooks.observe(
      'asset:afterDelete',
      { id, spaceIds, size },
      { manablox, spaceId: spaceIds[0] ?? null },
    );
  }

  /** Drops every cached delivery that serialised the asset, plus the asset lists of `listSpaceIds`. */
  async purgeCache(
    assetId: string | null,
    spaceId: string,
    listSpaceIds: string[] = [],
  ): Promise<void> {
    const manablox = this.options.manablox;
    if (!manablox) return;
    await purgeTags(manablox, spaceId, [
      ...(assetId ? [`asset:${assetId}`] : []),
      ...listSpaceIds.map((id) => `asset-list:${id}`),
    ]);
  }
}
