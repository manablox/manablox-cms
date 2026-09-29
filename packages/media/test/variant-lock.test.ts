import type { AssetRow, Repositories } from '@manablox/db';
import type { StorageDriver } from '@manablox/storage';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { MediaService, type VariantLock } from '../src/service.js';

const asset = {
  id: 'a1',
  key: 'space/2026/09/photo.png',
  mimeType: 'image/png',
  meta: {},
  updatedAt: new Date('2026-09-10T12:00:00Z'),
} as unknown as AssetRow;

/** One shared storage and variant table, like two replicas on one database. */
async function sharedBackend() {
  const source = await sharp({
    create: { width: 40, height: 20, channels: 3, background: '#c33' },
  })
    .png()
    .toBuffer();
  const objects = new Map<string, Buffer>([[asset.key, source]]);
  const variants = new Map<string, { key: string }>();
  let renders = 0;

  const storage = {
    name: 'memory',
    get: async (key: string) => {
      const body = objects.get(key);
      if (!body) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      if (key === asset.key) renders++;
      return body;
    },
    exists: async (key: string) => objects.has(key),
    put: async (key: string, body: Buffer) => {
      // Slow enough for a second caller to arrive mid-render.
      await new Promise((resolve) => setTimeout(resolve, 50));
      objects.set(key, body);
    },
  } as unknown as StorageDriver;
  const repos = {
    assets: {
      findById: async () => asset,
      findVariant: async (id: string, preset: string, format: string) =>
        variants.get(`${id}:${preset}:${format}`) ?? null,
      upsertVariant: async (row: {
        assetId: string;
        preset: string;
        format: string;
        key: string;
      }) => {
        variants.set(`${row.assetId}:${row.preset}:${row.format}`, { key: row.key });
      },
    },
  } as unknown as Repositories;

  return { storage, repos, renders: () => renders };
}

/** A lock shared by the services built on it, as Redis would be. */
function sharedLock(): VariantLock & { held: Set<string> } {
  const held = new Set<string>();
  return {
    held,
    async acquire(key) {
      if (held.has(key)) return null;
      held.add(key);
      return async () => {
        held.delete(key);
      };
    },
  };
}

function service(backend: Awaited<ReturnType<typeof sharedBackend>>, variantLock?: VariantLock) {
  return new MediaService(
    backend.repos,
    backend.storage,
    { presets: { thumb: { width: 10, fit: 'inside' } } },
    { maxFileSize: 1024, allowedMimeTypes: [], variantLock },
  );
}

describe('variant render lock', () => {
  it('renders once when a request arrives while the worker renders', async () => {
    const backend = await sharedBackend();
    const media = service(backend);

    const [, served] = await Promise.all([
      media.renderVariant({ assetId: asset.id, preset: 'thumb', format: 'webp' }),
      media.derive(asset, 'thumb', 'webp'),
    ]);

    expect(backend.renders()).toBe(1);
    expect((await sharp(served.body).metadata()).width).toBe(10);
  });

  it('waits for another process holding the lock and serves its result', async () => {
    const backend = await sharedBackend();
    const lock = sharedLock();
    const worker = service(backend, lock);
    const api = service(backend, lock);

    const [first, second] = await Promise.all([
      worker.derive(asset, 'thumb', 'webp'),
      api.derive(asset, 'thumb', 'webp'),
    ]);

    expect(backend.renders()).toBe(1);
    expect(second.body.equals(first.body)).toBe(true);
    expect(lock.held.size).toBe(0);
  });

  it('renders without the lock when it is unavailable', async () => {
    const backend = await sharedBackend();
    const media = service(backend, {
      acquire: async () => {
        throw new Error('ECONNREFUSED');
      },
    });

    const { contentType } = await media.derive(asset, 'thumb', 'webp');
    expect(contentType).toBe('image/webp');
    expect(backend.renders()).toBe(1);
  });
});
