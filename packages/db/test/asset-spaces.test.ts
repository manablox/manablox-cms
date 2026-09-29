import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRepositoryContext, type RepositoryTestContext } from './helpers/repository.js';

let ctx: RepositoryTestContext;
let otherSpaceId: string;

beforeAll(async () => {
  ctx = await createRepositoryContext('asset_spaces');
  otherSpaceId = (
    await ctx.repos.spaces.create({
      name: 'Other',
      machineName: 'other',
      url: 'http://localhost:3003',
    })
  ).id;
});
afterAll(async () => {
  await ctx?.close();
});

const createAsset = (filename: string, spaceId = ctx.spaceId) =>
  ctx.repos.assets.create({
    spaceId,
    driver: 'local',
    key: `k/${filename}`,
    filename,
    name: filename,
    mimeType: 'image/jpeg',
    size: 10,
    checksum: filename,
  });

const listed = async (spaceId: string) =>
  (await ctx.repos.assets.page({ spaceId }, { limit: 50, offset: 0 })).items.map((a) => a.name);

describe('assets across spaces', () => {
  it('an upload is in the space it was uploaded to, and only there', async () => {
    const asset = await createAsset('own.jpg');
    expect((await ctx.repos.assets.listSpaceIdsByAssets([asset.id])).get(asset.id)).toEqual([
      ctx.spaceId,
    ]);
    expect(await listed(ctx.spaceId)).toContain('own.jpg');
    expect(await listed(otherSpaceId)).not.toContain('own.jpg');
    expect(await ctx.repos.assets.findById(asset.id, otherSpaceId)).toBeNull();
    expect(await ctx.repos.assets.listByIds([asset.id], otherSpaceId)).toEqual([]);
    expect(await ctx.repos.assets.findByChecksum(otherSpaceId, 'own.jpg')).toBeNull();
  });

  it('shared, the same record shows in every space it is in', async () => {
    const asset = await createAsset('shared.jpg');
    await ctx.repos.assets.setSpaces(asset.id, [ctx.spaceId, otherSpaceId]);

    expect(await listed(otherSpaceId)).toContain('shared.jpg');
    expect((await ctx.repos.assets.findById(asset.id, otherSpaceId))?.id).toBe(asset.id);
    expect(
      [...((await ctx.repos.assets.listSpaceIdsByAssets([asset.id])).get(asset.id) ?? [])].sort(),
    ).toEqual([ctx.spaceId, otherSpaceId].sort());

    // Drops unnamed spaces, keeps named ones.
    await ctx.repos.assets.setSpaces(asset.id, [otherSpaceId]);
    expect(await listed(ctx.spaceId)).not.toContain('shared.jpg');
    expect(await listed(otherSpaceId)).toContain('shared.jpg');
  });

  it('refuses to leave an asset in no space', async () => {
    const asset = await createAsset('lonely.jpg');
    await expect(ctx.repos.assets.setSpaces(asset.id, [])).rejects.toMatchObject({
      key: 'asset.spaces.required',
    });
  });

  it('a deleted space takes its own assets and leaves the shared ones', async () => {
    const doomed = (
      await ctx.repos.spaces.create({
        name: 'Doomed',
        machineName: 'doomed',
        url: 'http://localhost:3004',
      })
    ).id;
    const own = await createAsset('doomed-own.jpg', doomed);
    const shared = await createAsset('doomed-shared.jpg', doomed);
    await ctx.repos.assets.addToSpace(shared.id, ctx.spaceId);

    await ctx.repos.spaces.delete(doomed);
    const orphans = await ctx.repos.assets.deleteOrphanedReturning();

    expect(orphans.map((row) => row.id)).toEqual([own.id]);
    expect(await ctx.repos.assets.findById(own.id)).toBeNull();
    expect((await ctx.repos.assets.listSpaceIdsByAssets([shared.id])).get(shared.id)).toEqual([
      ctx.spaceId,
    ]);
  });
});

describe('asset list mime filters', () => {
  let spaceId: string;
  const names = async (filter: { mimeType?: string; mimeTypeNot?: string[] }, limit = 50) =>
    ctx.repos.assets.page({ spaceId, ...filter }, { limit, offset: 0 });

  beforeAll(async () => {
    spaceId = (
      await ctx.repos.spaces.create({
        name: 'Mimes',
        machineName: 'mimes',
        url: 'http://localhost:3005',
      })
    ).id;
    const files: [string, string][] = [
      ['a.jpg', 'image/jpeg'],
      ['b.png', 'image/png'],
      ['c.pdf', 'application/pdf'],
      ['d.mp4', 'video/mp4'],
      ['e.txt', 'text/plain'],
    ];
    for (const [filename, mimeType] of files) {
      await ctx.repos.assets.create({
        spaceId,
        driver: 'local',
        key: `m/${filename}`,
        filename,
        name: filename,
        mimeType,
        size: 10,
        checksum: `mime-${filename}`,
      });
    }
  });

  it('keeps a prefix', async () => {
    const page = await names({ mimeType: 'image/' });
    expect(page.items.map((a) => a.name).sort()).toEqual(['a.jpg', 'b.png']);
    expect(page.total).toBe(2);
  });

  it('leaves out every excluded prefix, counted in the total', async () => {
    const page = await names({ mimeTypeNot: ['image/'] }, 2);
    expect(page.items).toHaveLength(2);
    expect(page.items.every((a) => !a.mimeType.startsWith('image/'))).toBe(true);
    expect(page.total).toBe(3);
    const narrower = await names({ mimeTypeNot: ['image/', 'video/'] });
    expect(narrower.items.map((a) => a.name).sort()).toEqual(['c.pdf', 'e.txt']);
  });

  it('treats wildcards in a prefix literally', async () => {
    expect((await names({ mimeType: '%' })).total).toBe(0);
    expect((await names({ mimeTypeNot: ['_'] })).total).toBe(5);
  });
});
