import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createRepositoryContext,
  makeNode,
  type RepositoryTestContext,
} from './helpers/repository.js';

let ctx: RepositoryTestContext;
let assetA: string;
let assetB: string;

beforeAll(async () => {
  ctx = await createRepositoryContext('asset_usage');
  assetA = (await createAsset('a.jpg')).id;
  assetB = (await createAsset('b.jpg')).id;
});
afterAll(async () => {
  await ctx?.close();
});

const createAsset = (filename: string) =>
  ctx.repos.assets.create({
    spaceId: ctx.spaceId,
    driver: 'local',
    key: `k/${filename}`,
    filename,
    name: filename,
    mimeType: 'image/jpeg',
    size: 10,
  });

const published = (ids: string[]) => ctx.repos.assetUsages.filterPublished(ids);

describe('asset reachability', () => {
  it('a draft reference does not make an asset public', async () => {
    const node = await makeNode(ctx, { title: 'Draft', slug: 'draft' });
    await ctx.repos.assetUsages.recordDraft(node.id, ctx.spaceId, [assetA]);

    expect([...(await published([assetA]))]).toEqual([]);
    expect(await ctx.repos.assetUsages.listByContent(node.id)).toEqual([
      { assetId: assetA, published: false },
    ]);
  });

  it('publishing makes exactly the referenced assets public', async () => {
    const node = await makeNode(ctx, { title: 'Live', slug: 'live' });
    await ctx.repos.assetUsages.recordDraft(node.id, ctx.spaceId, [assetA, assetB]);
    await ctx.repos.assetUsages.recordPublished(node.id, ctx.spaceId, [assetA]);

    const reachable = await published([assetA, assetB]);
    expect(reachable.has(assetA)).toBe(true);
    expect(reachable.has(assetB)).toBe(false);
  });

  it('editing a draft does not revoke an asset the live page still shows', async () => {
    const node = await makeNode(ctx, { title: 'Edited', slug: 'edited' });
    await ctx.repos.assetUsages.recordPublished(node.id, ctx.spaceId, [assetA]);

    // Removed from the draft, not yet published.
    await ctx.repos.assetUsages.recordDraft(node.id, ctx.spaceId, []);

    expect((await published([assetA])).has(assetA)).toBe(true);
  });

  it('unpublishing the only referencing document revokes the asset', async () => {
    const asset = (await createAsset('lonely.jpg')).id;
    const node = await makeNode(ctx, { title: 'Lonely', slug: 'lonely' });

    await ctx.repos.assetUsages.recordPublished(node.id, ctx.spaceId, [asset]);
    expect((await published([asset])).has(asset)).toBe(true);

    await ctx.repos.assetUsages.clearPublished(node.id);
    expect((await published([asset])).has(asset)).toBe(false);
  });

  it('keeps an asset public while any other published document references it', async () => {
    const asset = (await createAsset('shared.jpg')).id;
    const one = await makeNode(ctx, { title: 'One', slug: 'one' });
    const two = await makeNode(ctx, { title: 'Two', slug: 'two' });

    await ctx.repos.assetUsages.recordPublished(one.id, ctx.spaceId, [asset]);
    await ctx.repos.assetUsages.recordPublished(two.id, ctx.spaceId, [asset]);

    await ctx.repos.assetUsages.clearPublished(one.id);
    expect((await published([asset])).has(asset)).toBe(true);
  });

  it('republishing without an asset revokes it', async () => {
    const asset = (await createAsset('dropped.jpg')).id;
    const node = await makeNode(ctx, { title: 'Dropped', slug: 'dropped' });

    await ctx.repos.assetUsages.recordPublished(node.id, ctx.spaceId, [asset]);
    await ctx.repos.assetUsages.recordPublished(node.id, ctx.spaceId, []);

    expect((await published([asset])).has(asset)).toBe(false);
  });

  it('drops every usage when the document is deleted', async () => {
    const node = await makeNode(ctx, { title: 'Doomed', slug: 'doomed' });
    await ctx.repos.assetUsages.recordPublished(node.id, ctx.spaceId, [assetA, assetB]);

    await ctx.repos.assetUsages.deleteByContent(node.id);
    expect(await ctx.repos.assetUsages.listByContent(node.id)).toEqual([]);
  });
});

/** `seed` takes a whole space's usages in one call. */
describe('seeding a whole import', () => {
  it('collapses a pair a document names more than once', async () => {
    const asset = (await createAsset('twice.jpg')).id;
    const node = await makeNode(ctx, { title: 'Twice', slug: 'twice' });

    // One image in two fields arrives twice.
    await ctx.repos.assetUsages.seed([
      { assetId: asset, contentId: node.id, spaceId: ctx.spaceId, published: false },
      { assetId: asset, contentId: node.id, spaceId: ctx.spaceId, published: true },
    ]);

    expect(await ctx.repos.assetUsages.listByContent(node.id)).toEqual([
      { assetId: asset, published: true },
    ]);
  });

  it('writes more usages than one statement can bind', async () => {
    // Five bind parameters a row against a 65534 ceiling.
    const assets: string[] = [];
    for (let index = 0; index < 350; index++) {
      assets.push((await createAsset(`bulk-${index}.jpg`)).id);
    }
    const nodes: string[] = [];
    for (let index = 0; index < 40; index++) {
      nodes.push((await makeNode(ctx, { title: `Bulk ${index}`, slug: `bulk-${index}` })).id);
    }
    const rows = nodes.flatMap((contentId) =>
      assets.map((assetId) => ({ assetId, contentId, spaceId: ctx.spaceId, published: true })),
    );
    expect(rows.length * 5).toBeGreaterThan(65534);

    await ctx.repos.assetUsages.seed(rows);

    expect(await ctx.repos.assetUsages.listByContent(nodes[0] as string)).toHaveLength(
      assets.length,
    );
    expect((await ctx.repos.assetUsages.filterPublished(assets)).size).toBe(assets.length);
  }, 300_000);
});
