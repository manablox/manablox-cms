import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MediaConfig, MediaPreset } from '@manablox/core';
import type { AssetRow, Repositories } from '@manablox/db';
import { isMissingObject, type StorageDriver } from '@manablox/storage';
import { readImageEdits } from './edits.js';
import { renderedSize, transform } from './transform.js';
import type { MediaServiceOptions } from './types.js';

type Rendered = { body: Buffer; contentType: string };

/** Lock lifetime; also how long a caller waits for another holder's render. */
const LOCK_TTL = 30_000;
const LOCK_POLL = 200;

/** Renders preset variants into storage, or into a local cache on read-only instances. */
export class VariantRenderer {
  private readonly inflight = new Map<string, Promise<Rendered>>();

  constructor(
    private readonly repos: Repositories,
    private readonly storage: StorageDriver,
    private readonly config: MediaConfig,
    private readonly options: MediaServiceOptions,
  ) {}

  private get logger() {
    return this.options.manablox?.logger;
  }

  /** True when the variant is recorded and its object is still stored. */
  async has(assetId: string, presetName: string, format: string): Promise<boolean> {
    const cached = await this.repos.assets.findVariant(assetId, presetName, format);
    return cached ? this.storage.exists(cached.key) : false;
  }

  /**
   * Returns bytes for a checked preset, generating and caching the variant on first request.
   * Concurrent calls for one variant share a single render.
   */
  render(
    asset: AssetRow,
    presetName: string,
    preset: MediaPreset,
    format: string,
  ): Promise<Rendered> {
    const variantKey = `${asset.key}.${presetName}.${format}`;
    const running = this.inflight.get(variantKey);
    if (running) return running;

    const flight = this.renderOnce(asset, variantKey, presetName, preset, format).finally(() =>
      this.inflight.delete(variantKey),
    );
    this.inflight.set(variantKey, flight);
    return flight;
  }

  private async renderOnce(
    asset: AssetRow,
    variantKey: string,
    presetName: string,
    preset: MediaPreset,
    format: string,
  ): Promise<Rendered> {
    const contentType = `image/${format}`;
    const stored = await this.stored(asset.id, presetName, format);
    if (stored) return { body: stored, contentType };

    if (this.options.readOnly) return this.deriveLocally(asset, presetName, preset, format);

    const release = await this.lock(variantKey, () => this.stored(asset.id, presetName, format));
    if (Buffer.isBuffer(release)) return { body: release, contentType };

    try {
      const source = await this.storage.get(asset.key);
      const body = await transform(source, preset, format, readImageEdits(asset.meta));
      const size = await renderedSize(body);

      await this.storage.put(variantKey, body, {
        contentType,
        cacheControl: 'public, max-age=31536000, immutable',
      });

      await this.repos.assets.upsertVariant({
        assetId: asset.id,
        preset: presetName,
        format,
        key: variantKey,
        width: size.width,
        height: size.height,
        size: body.byteLength,
      });

      return { body, contentType };
    } finally {
      await release?.().catch((err: unknown) =>
        this.logger?.warn({ err, key: variantKey }, 'variant lock not released'),
      );
    }
  }

  /**
   * Takes the shared lock. While another process holds it, polls for that render's result
   * and returns its bytes; after `LOCK_TTL` renders without the lock.
   */
  private async lock(
    key: string,
    finished: () => Promise<Buffer | null>,
  ): Promise<(() => Promise<void>) | Buffer | null> {
    const lock = this.options.variantLock;
    if (!lock) return null;

    const deadline = Date.now() + LOCK_TTL;
    for (let waited = false; ; waited = true) {
      const release = await lock.acquire(key, LOCK_TTL).catch((err: unknown) => {
        this.logger?.warn({ err, key }, 'variant lock unavailable');
        return undefined;
      });
      if (release === undefined) return null;
      if (release) {
        // The previous holder may have stored it just before letting go.
        const done = waited ? await finished() : null;
        if (!done) return release;
        await release().catch((err: unknown) =>
          this.logger?.warn({ err, key }, 'variant lock not released'),
        );
        return done;
      }
      if (Date.now() >= deadline) return null;
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL));
      const done = await finished();
      if (done) return done;
    }
  }

  /** The recorded variant's bytes, or null when it is not rendered yet. */
  private async stored(
    assetId: string,
    presetName: string,
    format: string,
  ): Promise<Buffer | null> {
    const cached = await this.repos.assets.findVariant(assetId, presetName, format);
    return cached ? this.readVariant(cached.key) : null;
  }

  /** A stored variant's bytes, or null when the object is gone. */
  private async readVariant(key: string): Promise<Buffer | null> {
    try {
      return await this.storage.get(key);
    } catch (error) {
      // Drivers that report absence differently are asked directly.
      if (isMissingObject(error) || !(await this.storage.exists(key))) return null;
      throw error;
    }
  }

  /**
   * `derive` for read-only instances: renders into the local cache, keyed by asset version.
   * Caching is best effort.
   */
  private async deriveLocally(
    asset: AssetRow,
    presetName: string,
    preset: MediaPreset,
    format: string,
  ): Promise<{ body: Buffer; contentType: string }> {
    const contentType = `image/${format}`;
    const version = asset.updatedAt.getTime().toString(36);
    const dir = this.config.cachePath ? join(this.config.cachePath, asset.id) : null;
    const file = dir ? join(dir, `${presetName}.${version}.${format}`) : null;

    if (file) {
      // A miss renders afresh.
      const hit = await readFile(file).catch((err: unknown) => {
        this.logger?.debug({ err, assetId: asset.id, file }, 'local variant cache miss');
        return null;
      });
      if (hit) return { body: hit, contentType };
    }

    const source = await this.storage.get(asset.key);
    const body = await transform(source, preset, format, readImageEdits(asset.meta));

    if (dir && file) {
      // Renamed into place so no request reads half a file.
      const partial = `${file}.${process.pid}.${Date.now()}.tmp`;
      await mkdir(dir, { recursive: true })
        .then(() => writeFile(partial, body))
        .then(() => rename(partial, file))
        .catch(async (err: unknown) => {
          this.logger?.warn({ err, assetId: asset.id, file }, 'local variant not cached');
          // Leftover temp files are harmless; `force` already ignores a missing one.
          await rm(partial, { force: true }).catch((rmErr: unknown) =>
            this.logger?.debug({ err: rmErr, file: partial }, 'temp variant not removed'),
          );
        });
    }

    return { body, contentType };
  }
}
