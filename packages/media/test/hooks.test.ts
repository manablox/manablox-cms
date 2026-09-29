import type { Manablox } from '@manablox/core/node';
import type { AssetRow, Repositories } from '@manablox/db';
import type { StorageDriver } from '@manablox/storage';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { MediaService } from '../src/service.js';

const SPACE = 's1';

/** A service over stub repos, recording every hook and limit check it runs. */
function service(rename?: (filename: string) => string, refuseStorage = false) {
  const runs: Array<[string, unknown]> = [];
  const manablox = {
    controls: {
      resolved: async () => ({ uploads: { maxFileSize: null, allowedMimeTypes: null } }),
      assertLimit: async (spaceId: string, key: string, options: unknown) => {
        runs.push(['limit', { spaceId, key, ...(options as object) }]);
        if (refuseStorage) throw new Error('storage full');
        return [];
      },
    },
    hooks: {
      run: async (name: string, payload: { filename: string }) => {
        runs.push([name, payload]);
        if (name === 'asset:beforeUpload' && rename) {
          return { ...payload, filename: rename(payload.filename) };
        }
        return payload;
      },
      observe: async (name: string, payload: unknown) => {
        runs.push([name, payload]);
      },
    },
  } as unknown as Manablox;
  const row = {
    id: 'a1',
    spaceId: SPACE,
    name: 'photo',
    filename: 'photo.png',
    mimeType: 'image/png',
    size: 100,
    meta: {},
  } as unknown as AssetRow;
  const puts: string[] = [];
  const storage = {
    name: 'local',
    put: async (key: string) => {
      puts.push(key);
    },
    delete: async () => undefined,
  } as unknown as StorageDriver;
  const repos = {
    spaces: { findById: async () => ({ id: SPACE, settings: {} }) },
    assets: {
      findByChecksum: async () => null,
      create: async (data: Partial<AssetRow>) => ({ ...row, ...data }),
      findById: async () => row,
      update: async (_id: string, data: Partial<AssetRow>) => ({ ...row, ...data }),
      removeFromSpace: async () => undefined,
      listSpaceIdsByAssets: async () => new Map(),
      listVariantsByAssets: async () => [{ key: 'v1', size: 20 }],
      delete: async () => true,
    },
    audit: { record: async () => undefined },
    locks: { withLock: <T>(_name: string, fn: () => Promise<T>) => fn() },
  } as unknown as Repositories;
  const media = new MediaService(
    repos,
    storage,
    { cachePath: '/tmp/unused' },
    { maxFileSize: 1024 * 1024, allowedMimeTypes: [], manablox },
  );
  return { media, runs, puts };
}

const png = () =>
  sharp({ create: { width: 4, height: 4, channels: 3, background: '#c33' } })
    .png()
    .toBuffer();

describe('media hooks', () => {
  it('runs asset:beforeUpload with the sniffed type and stores the returned name', async () => {
    const { media, runs, puts } = service((filename) => `renamed-${filename}`);
    const asset = await media.upload({
      spaceId: SPACE,
      filename: 'photo.png',
      mimeType: 'application/octet-stream',
      body: await png(),
    });

    const [name, payload] = runs[0] ?? [];
    expect(name).toBe('asset:beforeUpload');
    expect(payload).toMatchObject({ filename: 'photo.png', mimeType: 'image/png' });
    expect(puts[0]).toContain('renamed-photo');
    expect(asset.name).toBe('renamed-photo');
  });

  it('checks the storage limit with the upload size before storing it', async () => {
    const body = await png();
    const { media, runs } = service();
    await media.upload({ spaceId: SPACE, filename: 'x.png', mimeType: 'image/png', body });
    expect(runs.filter(([name]) => name === 'limit')).toEqual([
      ['limit', { spaceId: SPACE, key: 'storageBytes', increment: body.byteLength }],
    ]);

    const refused = service(undefined, true);
    await expect(
      refused.media.upload({ spaceId: SPACE, filename: 'x.png', mimeType: 'image/png', body }),
    ).rejects.toThrow('storage full');
    expect(refused.puts).toEqual([]);
  });

  it('lets asset:beforeUpload reject a file', async () => {
    const { media } = service(() => {
      throw new Error('no uploads today');
    });
    await expect(
      media.upload({ spaceId: SPACE, filename: 'x.png', mimeType: 'image/png', body: await png() }),
    ).rejects.toThrow('no uploads today');
  });

  it('purges the asset tag on every asset write', async () => {
    const { media, runs } = service();
    await media.update(SPACE, 'a1', { alt: 'New alt' });
    await media.schedule(SPACE, 'a1', { publishAt: null });
    await media.delete(SPACE, 'a1');

    const purges = runs.filter(([name]) => name === 'cache:purge').map(([, payload]) => payload);
    expect(purges).toEqual([
      { tags: ['asset:a1'] },
      { tags: ['asset:a1'] },
      { tags: ['asset:a1'] },
    ]);
  });

  it('runs asset:afterDelete with the size of the original and its variants', async () => {
    const { media, runs } = service();
    await media.delete(SPACE, 'a1');
    expect(runs.filter(([name]) => name === 'asset:afterDelete')).toEqual([
      ['asset:afterDelete', { id: 'a1', spaceIds: [SPACE], size: 120 }],
    ]);
  });

  it('purges the space asset lists on an upload, which any of them may now include', async () => {
    const { media, runs } = service();
    await media.upload({
      spaceId: SPACE,
      filename: 'photo.png',
      mimeType: 'image/png',
      body: await png(),
    });

    const purges = runs.filter(([name]) => name === 'cache:purge').map(([, payload]) => payload);
    expect(purges).toEqual([{ tags: [`asset-list:${SPACE}`] }]);
  });

  it('purges the asset lists on a rename, since lists search the name', async () => {
    const { media, runs } = service();
    await media.update(SPACE, 'a1', { name: 'renamed' });

    const purges = runs.filter(([name]) => name === 'cache:purge').map(([, payload]) => payload);
    expect(purges).toEqual([{ tags: ['asset:a1', `asset-list:${SPACE}`] }]);
  });
});
