import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import { ManabloxError, type MediaPreset, snapshotChanges } from '@manablox/core';
import type { AssetRow } from '@manablox/db';
import { buildStorageKey } from '@manablox/storage';
import { ASSET_DIFF, type MediaContext } from './context.js';
import {
  readSpaceAssetSettings,
  resolveUploadRules,
  type UploadRuleSet,
  type UploadRules,
  uploadTypeAllowed,
} from './limits.js';
import { detectMimeType, IMAGE_FORMATS, probeImage } from './transform.js';
import type { DeriveJob, UploadInput } from './types.js';
import { VariantRenderer } from './variants.js';

/** An upload's bytes as the pipeline reads them. */
interface UploadSource {
  size: number;
  checksum: string;
  head: Buffer;
  open(): Buffer | Readable;
  /** What sharp reads: the bytes or a file path. */
  image: Buffer | string;
}

function sourceOf(body: UploadInput['body']): UploadSource {
  if (Buffer.isBuffer(body)) {
    return {
      size: body.byteLength,
      checksum: createHash('sha256').update(body).digest('hex'),
      head: body,
      open: () => body,
      image: body,
    };
  }
  return {
    size: body.size,
    checksum: body.checksum,
    head: body.head,
    open: () => createReadStream(body.path),
    image: body.path,
  };
}

/** Upload, probing, and on-demand image derivatives. */
export class AssetUploads {
  private readonly variants: VariantRenderer;

  constructor(private readonly ctx: MediaContext) {
    this.variants = new VariantRenderer(ctx.repos, ctx.storage, ctx.config, ctx.options);
  }

  /** The space's upload rules, with the env and control bounds they narrow. */
  async limits(spaceId: string): Promise<UploadRuleSet> {
    const [space, controls] = await Promise.all([
      this.ctx.repos.spaces.findById(spaceId),
      this.ctx.options.manablox?.controls.resolved(spaceId),
    ]);
    return resolveUploadRules(
      this.ctx.options,
      controls?.uploads ?? null,
      readSpaceAssetSettings(space?.settings),
    );
  }

  /** What uploads to the space accept: the strictest of env, controls and space settings. */
  async effectiveUploadRules(spaceId: string): Promise<UploadRules> {
    return (await this.limits(spaceId)).effective;
  }

  async upload(input: UploadInput): Promise<AssetRow> {
    const rules = await this.effectiveUploadRules(input.spaceId);
    const source = sourceOf(input.body);
    if (source.size > rules.maxFileSize) {
      throw ManabloxError.tooLarge('asset.tooLarge', {
        size: source.size,
        max: rules.maxFileSize,
      });
    }

    // Trust the bytes, not the client's Content-Type.
    const detected = await detectMimeType(source.head, input.mimeType);
    if (!uploadTypeAllowed(detected, rules)) {
      throw ManabloxError.badRequest('asset.mimeType.notAllowed', { mimeType: detected });
    }

    const manablox = this.ctx.options.manablox;
    const { filename } = manablox
      ? await manablox.hooks.run(
          'asset:beforeUpload',
          { filename: input.filename, mimeType: detected, size: source.size },
          { manablox, spaceId: input.spaceId },
        )
      : input;

    // Serializes identical uploads so the second finds the first asset.
    const { asset, created } = await this.ctx.repos.locks.withLock(
      `assets:upload:${input.spaceId}:${source.checksum}`,
      async () => {
        const existing = await this.ctx.repos.assets.findByChecksum(input.spaceId, source.checksum);
        if (existing) return { asset: existing, created: false };
        return { asset: await this.store(input, source, filename, detected), created: true };
      },
    );
    if (!created) return asset;

    await this.ctx.audit.record(
      'asset.upload',
      { ...asset, spaceId: input.spaceId },
      snapshotChanges(asset, 'created', ASSET_DIFF),
    );

    // A new file can join any asset list of the space.
    await this.ctx.purgeCache(null, input.spaceId, [input.spaceId]);

    // Eager presets keep the first page view off the transform path.
    if (asset.width !== null) await this.deriveEager(asset);

    return asset;
  }

  /** Stores the bytes and inserts the asset, within the storage limit. */
  private async store(
    input: UploadInput,
    source: UploadSource,
    filename: string,
    detected: string,
  ): Promise<AssetRow> {
    await this.ctx.options.manablox?.controls.assertLimit(input.spaceId, 'storageBytes', {
      increment: source.size,
    });

    const key = buildStorageKey(input.spaceId, filename);
    await this.ctx.storage.put(key, source.open(), { contentType: detected });

    const dimensions = await probeImage(source.image, detected);

    return this.ctx.repos.assets.create({
      spaceId: input.spaceId,
      driver: this.ctx.storage.name,
      key,
      filename: key.split('/').pop() ?? filename,
      name: filename.replace(/\.[^.]+$/, ''),
      mimeType: detected,
      size: source.size,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      checksum: source.checksum,
      alt: input.alt ?? null,
      title: input.title ?? null,
      actorId: input.actorId ?? null,
    });
  }

  /** Queues the eager presets, or renders them inline without a queue; a miss renders on first request. */
  private async deriveEager(asset: AssetRow): Promise<void> {
    const queue = this.ctx.options.queueDerive;
    for (const preset of this.ctx.config.eager ?? []) {
      const config = this.ctx.config.presets?.[preset];
      if (!config) continue;
      const job = { assetId: asset.id, preset, format: config.format ?? 'webp' };
      // The upload stands either way.
      await (queue ? queue(job) : this.derive(asset, preset, job.format)).catch((err: unknown) =>
        this.ctx.logger?.warn(
          { err, assetId: asset.id, preset },
          queue ? 'eager variant not queued' : 'eager variant not rendered',
        ),
      );
    }
  }

  /** Renders a queued variant into storage; a cached variant or a deleted asset is a no-op. */
  async renderVariant(job: DeriveJob): Promise<void> {
    try {
      const asset = await this.ctx.repos.assets.findById(job.assetId);
      if (!asset || (await this.variants.has(asset.id, job.preset, job.format))) return;
      await this.derive(asset, job.preset, job.format);
    } catch (err) {
      this.ctx.logger?.warn(
        { err, assetId: job.assetId, preset: job.preset, format: job.format },
        'variant not rendered',
      );
      throw err;
    }
  }

  /** Returns bytes for a preset, generating and caching the variant on first request. */
  async derive(
    asset: AssetRow,
    presetName: string,
    format: string,
  ): Promise<{ body: Buffer; contentType: string }> {
    const preset = this.preset(presetName);
    if (!preset) throw ManabloxError.notFound('media.preset.notFound', { preset: presetName });
    if (!IMAGE_FORMATS.has(format)) {
      throw ManabloxError.badRequest('media.format.unsupported', { format });
    }
    if (!asset.mimeType.startsWith('image/')) {
      throw ManabloxError.badRequest('media.notAnImage', { assetId: asset.id });
    }

    return this.variants.render(asset, presetName, preset, format);
  }

  /** A preset by name: the configuration's, or one the content model declares. */
  preset(name: string): MediaPreset | undefined {
    return this.ctx.config.presets?.[name] ?? this.ctx.options.declaredPresets?.()[name];
  }
}
