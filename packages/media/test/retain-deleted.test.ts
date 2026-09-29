import type { AssetRow, Repositories } from '@manablox/db';
import type { StorageDriver } from '@manablox/storage';
import { describe, expect, it } from 'vitest';
import { MediaService } from '../src/service.js';

const SPACE = 's1';

/** A service over stub repos recording deleted keys; `retain` answers `retainDeleted`. */
function service(retain?: (asset: { id: string; keys: string[] }, spaceIds: string[]) => boolean) {
  const deleted: string[] = [];
  const retained: Array<[{ id: string; keys: string[] }, string[]]> = [];
  const row = {
    id: 'a1',
    key: 's1/2026/09/photo.png',
    size: 100,
    name: 'photo',
    mimeType: 'image/png',
    meta: {},
  } as unknown as AssetRow;
  const storage = {
    name: 'local',
    delete: async (key: string) => {
      deleted.push(key);
    },
  } as unknown as StorageDriver;
  const repos = {
    assets: {
      findById: async () => row,
      removeFromSpace: async () => undefined,
      listSpaceIdsByAssets: async () => new Map(),
      listVariantsByAssets: async () => [{ key: 'v1', size: 20 }],
      deleteOrphanedReturning: async () => [row],
      delete: async () => true,
    },
    audit: { record: async () => undefined },
  } as unknown as Repositories;
  const media = new MediaService(
    repos,
    storage,
    { cachePath: '/tmp/unused' },
    {
      maxFileSize: 1024,
      allowedMimeTypes: [],
      ...(retain
        ? {
            retainDeleted: async (asset, spaceIds) => {
              retained.push([asset, spaceIds]);
              return retain(asset, spaceIds);
            },
          }
        : {}),
    },
  );
  return { media, deleted, retained };
}

describe('deleted asset files', () => {
  it('deletes the original and its variants without a keeper', async () => {
    const { media, deleted } = service();
    await media.delete(SPACE, 'a1');
    expect(deleted.sort()).toEqual(['s1/2026/09/photo.png', 'v1']);
  });

  it('keeps the original when the keeper takes it, and still deletes variants', async () => {
    const { media, deleted, retained } = service(() => true);
    await media.delete(SPACE, 'a1');
    expect(deleted).toEqual(['v1']);
    expect(retained).toEqual([[{ id: 'a1', keys: ['s1/2026/09/photo.png'] }, [SPACE]]]);
  });

  it('deletes the original when the keeper declines', async () => {
    const { media, deleted } = service(() => false);
    await media.delete(SPACE, 'a1');
    expect(deleted.sort()).toEqual(['s1/2026/09/photo.png', 'v1']);
  });

  it('deletes the original when the keeper fails', async () => {
    const { media, deleted } = service(() => {
      throw new Error('storage down');
    });
    await media.delete(SPACE, 'a1');
    expect(deleted.sort()).toEqual(['s1/2026/09/photo.png', 'v1']);
  });

  it('asks the keeper about orphans, which are in no space any more', async () => {
    const { media, deleted, retained } = service(() => true);
    expect(await media.purgeOrphaned()).toBe(1);
    expect(deleted).toEqual([]);
    expect(retained).toEqual([[{ id: 'a1', keys: ['s1/2026/09/photo.png'] }, []]]);
  });
});
