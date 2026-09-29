import type { Manablox } from '@manablox/core/node';
import type { AssetRow, Repositories } from '@manablox/db';
import type { StorageDriver } from '@manablox/storage';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { type DeriveJob, MediaService } from '../src/service.js';

const SPACE = 's1';

/** A service over in-memory storage and variant rows. */
async function service(options: { queueDerive?: (job: DeriveJob) => Promise<void> } = {}) {
  const source = await sharp({
    create: { width: 40, height: 20, channels: 3, background: '#c33' },
  })
    .png()
    .toBuffer();
  const files = new Map<string, Buffer>();
  const variants = new Map<string, { key: string }>();
  const warn = vi.fn();
  const manablox = {
    hooks: { run: async (_name: string, payload: unknown) => payload },
    controls: {
      assertLimit: async () => [],
      resolved: async () => ({ uploads: { maxFileSize: null, allowedMimeTypes: null } }),
    },
    logger: { warn, debug: vi.fn() },
  } as unknown as Manablox;
  let row: AssetRow | null = null;
  const storage = {
    name: 'local',
    put: vi.fn(async (key: string, body: Buffer) => {
      files.set(key, body);
    }),
    get: vi.fn(async (key: string) => {
      const body = files.get(key);
      if (!body) throw new Error(`missing ${key}`);
      return body;
    }),
    exists: async (key: string) => files.has(key),
    delete: async () => undefined,
  } as unknown as StorageDriver;
  const repos = {
    spaces: { findById: async () => ({ id: SPACE, settings: {} }) },
    assets: {
      findByChecksum: async () => null,
      create: async (data: Partial<AssetRow>) => {
        row = { id: 'a1', meta: {}, updatedAt: new Date(), ...data } as AssetRow;
        return row;
      },
      findById: async () => row,
      findVariant: async (assetId: string, preset: string, format: string) =>
        variants.get(`${assetId}/${preset}/${format}`) ?? null,
      upsertVariant: vi.fn(
        async (v: { assetId: string; preset: string; format: string; key: string }) => {
          variants.set(`${v.assetId}/${v.preset}/${v.format}`, { key: v.key });
        },
      ),
    },
    audit: { record: async () => undefined },
    locks: { withLock: <T>(_name: string, fn: () => Promise<T>) => fn() },
  } as unknown as Repositories;
  const media = new MediaService(
    repos,
    storage,
    {
      cachePath: '/tmp/unused',
      presets: { thumb: { width: 10, fit: 'inside' } },
      eager: ['thumb'],
    },
    { maxFileSize: 1024 * 1024, allowedMimeTypes: [], manablox, ...options },
  );
  const upload = () =>
    media.upload({ spaceId: SPACE, filename: 'photo.png', mimeType: 'image/png', body: source });
  return { media, repos, storage, variants, warn, upload };
}

describe('eager variants', () => {
  it('render inside the upload without a queue', async () => {
    const { upload, variants } = await service();
    await upload();

    expect([...variants.keys()]).toEqual(['a1/thumb/webp']);
  });

  it('are queued, one job per preset, with a queue', async () => {
    const queueDerive = vi.fn(async () => undefined);
    const { upload, variants, storage } = await service({ queueDerive });
    await upload();

    expect(queueDerive).toHaveBeenCalledExactlyOnceWith({
      assetId: 'a1',
      preset: 'thumb',
      format: 'webp',
    });
    expect(variants.size).toBe(0);
    expect(storage.put).toHaveBeenCalledOnce();
  });

  it('leave the upload standing when the queue is down', async () => {
    const { upload, warn } = await service({
      queueDerive: async () => {
        throw new Error('redis away');
      },
    });
    const asset = await upload();

    expect(asset.id).toBe('a1');
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: 'a1', preset: 'thumb' }),
      'eager variant not queued',
    );
  });
});

describe('a queued variant', () => {
  const job = { assetId: 'a1', preset: 'thumb', format: 'webp' };

  it('renders once; a second job for it is a no-op', async () => {
    const { media, upload, repos, variants } = await service({
      queueDerive: async () => undefined,
    });
    await upload();

    await media.renderVariant(job);
    await media.renderVariant(job);

    expect(variants.has('a1/thumb/webp')).toBe(true);
    expect(repos.assets.upsertVariant).toHaveBeenCalledOnce();
  });

  it('logs a failure with the asset and preset and rethrows it for a retry', async () => {
    const { media, upload, storage, warn } = await service({ queueDerive: async () => undefined });
    await upload();
    vi.mocked(storage.get).mockRejectedValueOnce(new Error('storage away'));

    await expect(media.renderVariant(job)).rejects.toThrow('storage away');
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), assetId: 'a1', preset: 'thumb' }),
      'variant not rendered',
    );
  });
});
