import type { AssetImageEdits, MediaConfig, MediaPreset } from '@manablox/core';
import type { AssetFilter, AssetRow, Paginated, Pagination, Repositories } from '@manablox/db';
import type { StorageDriver } from '@manablox/storage';
import type { AssetSchedule } from './availability.js';
import { MediaContext } from './context.js';
import type { UploadRuleSet, UploadRules } from './limits.js';
import { AssetMetadata } from './metadata.js';
import { signTransform, transformPath, verifyTransform } from './signing.js';
import type { DeriveJob, MediaServiceOptions, PresentedAsset, UploadInput } from './types.js';
import { AssetUploads } from './uploads.js';

export type {
  DeriveJob,
  MediaServiceOptions,
  PresentedAsset,
  UploadInput,
  VariantLock,
} from './types.js';

/** Upload, probing, on-demand image derivatives, and asset edits. */
export class MediaService {
  private readonly ctx: MediaContext;
  private readonly uploads: AssetUploads;
  private readonly metadata: AssetMetadata;

  constructor(
    repos: Repositories,
    storage: StorageDriver,
    config: MediaConfig & { signingSecret?: string },
    options: MediaServiceOptions,
  ) {
    this.ctx = new MediaContext(repos, storage, config, options);
    this.uploads = new AssetUploads(this.ctx);
    this.metadata = new AssetMetadata(this.ctx);
  }

  /** The space's upload rules, with the env and control bounds they narrow. */
  limits(spaceId: string): Promise<UploadRuleSet> {
    return this.uploads.limits(spaceId);
  }

  /** What uploads to the space accept: the strictest of env, controls and space settings. */
  effectiveUploadRules(spaceId: string): Promise<UploadRules> {
    return this.uploads.effectiveUploadRules(spaceId);
  }

  upload(input: UploadInput): Promise<AssetRow> {
    return this.uploads.upload(input);
  }

  /** Renders a queued variant into storage; a cached variant or a deleted asset is a no-op. */
  renderVariant(job: DeriveJob): Promise<void> {
    return this.uploads.renderVariant(job);
  }

  /** Returns bytes for a preset, generating and caching the variant on first request. */
  derive(
    asset: AssetRow,
    presetName: string,
    format: string,
  ): Promise<{ body: Buffer; contentType: string }> {
    return this.uploads.derive(asset, presetName, format);
  }

  /** The space an asset's traffic counts in: its owning space, cached per process. */
  owningSpace(assetId: string): Promise<string | null> {
    return this.ctx.owners.get(assetId);
  }

  /** The row plus its URLs; only images get a thumbnail. */
  present(asset: AssetRow): PresentedAsset {
    return {
      ...asset,
      url: this.urlFor(asset),
      thumbnailUrl: asset.mimeType.startsWith('image/')
        ? this.urlFor(asset, 'thumb', 'webp')
        : null,
    };
  }

  /** A preset by name: the configuration's, or one the content model declares. */
  preset(name: string): MediaPreset | undefined {
    return this.uploads.preset(name);
  }

  /** The original's URL, or a preset's (signed if configured), versioned so edits bust caches. */
  urlFor(asset: AssetRow, presetName?: string, format = 'webp'): string {
    if (!presetName) return this.ctx.storage.url(asset.key) ?? `/media/${asset.id}/original`;

    const version = `v=${asset.updatedAt.getTime().toString(36)}`;
    const secret = this.ctx.config.signingSecret;
    if (!secret) return `/media/${asset.id}/${presetName}.${format}?${version}`;

    const request = { assetId: asset.id, preset: presetName, format };
    return `${transformPath(request, signTransform(secret, request))}&${version}`;
  }

  /** Stores the edits in `meta` (the original is kept) and drops the rendered variants. */
  setImageEdits(spaceId: string, assetId: string, edits: AssetImageEdits): Promise<AssetRow> {
    return this.metadata.setImageEdits(spaceId, assetId, edits);
  }

  /** Updates the name, alt text and title, in every space the asset is in. */
  update(
    spaceId: string,
    assetId: string,
    data: {
      name?: string | undefined;
      alt?: string | null | undefined;
      title?: string | null | undefined;
    },
  ): Promise<AssetRow> {
    return this.metadata.update(spaceId, assetId, data);
  }

  /** Sets the availability window; an omitted end is kept, `null` clears it. */
  schedule(spaceId: string, assetId: string, window: AssetSchedule): Promise<AssetRow> {
    return this.metadata.schedule(spaceId, assetId, window);
  }

  verify(assetId: string, preset: string, format: string, signature: string | undefined): boolean {
    const secret = this.ctx.config.signingSecret;
    if (!secret) return true;
    if (!signature) return false;
    return verifyTransform(secret, { assetId, preset, format }, signature);
  }

  /** The spaces each asset appears in. */
  spaceIdsOf(assetIds: string[]): Promise<Map<string, string[]>> {
    return this.ctx.repos.assets.listSpaceIdsByAssets(assetIds);
  }

  /**
   * Puts the asset in exactly these spaces, audited in each one affected. The caller
   * checks permissions.
   */
  setSpaces(spaceId: string, assetId: string, spaceIds: string[]): Promise<string[]> {
    return this.metadata.setSpaces(spaceId, assetId, spaceIds);
  }

  /** Removes the asset from `spaceId`, purging it entirely once no space holds it. */
  delete(spaceId: string, assetId: string): Promise<{ removed: 'space' | 'asset' }> {
    return this.metadata.delete(spaceId, assetId);
  }

  /** Deletes assets in no space and their files, best effort. */
  purgeOrphaned(): Promise<number> {
    return this.metadata.purgeOrphaned();
  }

  /** A page of the space's assets. */
  list(filter: AssetFilter, pagination: Pagination): Promise<Paginated<AssetRow>> {
    return this.ctx.repos.assets.page(filter, pagination);
  }

  /** The asset if it is in `spaceId`, else `null`. */
  get(spaceId: string, assetId: string): Promise<AssetRow | null> {
    return this.ctx.repos.assets.findById(assetId, spaceId);
  }

  /** The space's assets by id; missing ids are absent. */
  getMany(spaceId: string, assetIds: string[]): Promise<AssetRow[]> {
    return this.ctx.repos.assets.listByIds(assetIds, spaceId);
  }

  /** The asset in whatever spaces it is in. */
  find(assetId: string): Promise<AssetRow | null> {
    return this.ctx.repos.assets.findById(assetId);
  }
}
