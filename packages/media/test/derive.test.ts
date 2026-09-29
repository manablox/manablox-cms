import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AssetRow, Repositories } from '@manablox/db';
import type { StorageDriver } from '@manablox/storage';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MediaService } from '../src/service.js';

let cachePath: string;
beforeEach(async () => {
  cachePath = await mkdtemp(join(tmpdir(), 'manablox-media-'));
});
afterEach(async () => {
  await rm(cachePath, { recursive: true, force: true });
});

const asset = {
  id: 'a1',
  key: 'space/2026/09/photo.png',
  mimeType: 'image/png',
  meta: {},
  updatedAt: new Date('2026-09-10T12:00:00Z'),
} as unknown as AssetRow;

/** A public instance: storage and database reads only; every write throws. */
async function readOnlyService() {
  const source = await sharp({
    create: { width: 40, height: 20, channels: 3, background: '#c33' },
  })
    .png()
    .toBuffer();
  const reads: string[] = [];
  const storage = {
    name: 'local',
    get: async (key: string) => {
      reads.push(key);
      return source;
    },
    exists: async () => false,
    put: async () => {
      throw new Error('EROFS: read-only file system');
    },
  } as unknown as StorageDriver;
  const repos = {
    assets: {
      findVariant: async () => null,
      upsertVariant: async () => {
        throw new Error('permission denied for table asset_variants');
      },
    },
  } as unknown as Repositories;

  const media = new MediaService(
    repos,
    storage,
    { cachePath, presets: { card: { width: 10, fit: 'inside' } } },
    { maxFileSize: 1024, allowedMimeTypes: [], readOnly: true },
  );
  return { media, reads };
}

describe('derive on a read-only instance', () => {
  it('renders a variant without writing storage or the database', async () => {
    const { media } = await readOnlyService();
    const { body, contentType } = await media.derive(asset, 'card', 'webp');

    expect(contentType).toBe('image/webp');
    expect((await sharp(body).metadata()).width).toBe(10);
  });

  it('serves the second request from the local cache', async () => {
    const { media, reads } = await readOnlyService();
    const first = await media.derive(asset, 'card', 'webp');
    const second = await media.derive(asset, 'card', 'webp');

    expect(second.body.equals(first.body)).toBe(true);
    expect(reads).toHaveLength(1);
    expect(await readdir(join(cachePath, 'a1'))).toHaveLength(1);
  });

  it('renders afresh once the asset is edited, rather than serving the old crop', async () => {
    const { media, reads } = await readOnlyService();
    await media.derive(asset, 'card', 'webp');
    await media.derive({ ...asset, updatedAt: new Date('2026-09-11T12:00:00Z') }, 'card', 'webp');

    expect(reads).toHaveLength(2);
  });
});

/** A writable instance whose one stored variant may have vanished from storage. */
async function writableService(variantStored: boolean) {
  const source = await sharp({
    create: { width: 40, height: 20, channels: 3, background: '#3c3' },
  })
    .png()
    .toBuffer();
  const calls: string[] = [];
  const variantKey = `${asset.key}.card.webp`;
  const storage = {
    name: 'local',
    get: async (key: string) => {
      calls.push(`get:${key}`);
      if (key === variantKey && !variantStored) {
        throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
      }
      return key === variantKey ? Buffer.from('variant') : source;
    },
    exists: async (key: string) => {
      calls.push(`exists:${key}`);
      return variantStored;
    },
    put: async (key: string) => {
      calls.push(`put:${key}`);
      return { key, size: 1, contentType: 'image/webp' };
    },
  } as unknown as StorageDriver;
  const repos = {
    assets: {
      findVariant: async () => ({ key: variantKey }),
      upsertVariant: async () => {
        calls.push('upsertVariant');
      },
    },
  } as unknown as Repositories;

  const media = new MediaService(
    repos,
    storage,
    { cachePath, presets: { card: { width: 10, fit: 'inside' } } },
    { maxFileSize: 1024, allowedMimeTypes: [] },
  );
  return { media, calls, variantKey };
}

describe('derive with a stored variant', () => {
  it('serves it with one storage read and no existence check', async () => {
    const { media, calls, variantKey } = await writableService(true);
    const { body } = await media.derive(asset, 'card', 'webp');
    expect(body.toString()).toBe('variant');
    expect(calls).toEqual([`get:${variantKey}`]);
  });

  it('renders again when the stored object has gone missing', async () => {
    const { media, calls, variantKey } = await writableService(false);
    const { body } = await media.derive(asset, 'card', 'webp');
    expect((await sharp(body).metadata()).width).toBe(10);
    expect(calls).toEqual([
      `get:${variantKey}`,
      `get:${asset.key}`,
      `put:${variantKey}`,
      'upsertVariant',
    ]);
  });
});
