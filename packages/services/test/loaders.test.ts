import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attachAssetUsages } from '../src/asset-usages.js';
import { createLoaders } from '../src/loaders.js';
import { createServiceContext, type ServiceContext } from '../src/testing.js';
import { TEST_TYPES } from './helpers/types.js';

let ctx: ServiceContext;
const heroIds: string[] = [];

beforeAll(async () => {
  ctx = await createServiceContext('loaders', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
  });
  attachAssetUsages(ctx.manablox, ctx.content);

  // 50 articles, each with three relation fields pointing at distinct rows.
  const space = ctx.spaceId;
  for (let i = 0; i < 50; i++) {
    const asset = await ctx.repos.assets.create({
      spaceId: space,
      driver: 'local',
      key: `k${i}`,
      filename: `f${i}.jpg`,
      name: `f${i}`,
      mimeType: 'image/jpeg',
      size: 1,
    });
    heroIds.push(asset.id);
  }

  const related = await ctx.content.create({
    spaceId: space,
    typeId: ctx.ids.article as string,
    locale: 'en',
    title: 'Related',
    slug: 'related-target',
    fields: {},
  });

  for (let i = 0; i < 50; i++) {
    await ctx.content.create({
      spaceId: space,
      typeId: ctx.ids.article as string,
      locale: 'en',
      title: `Article ${i}`,
      slug: `article-${i}`,
      fields: { hero: heroIds[i], related: related.id },
    });
  }
});

afterAll(async () => {
  await ctx?.close();
});

describe('relation batching', () => {
  /** Must stay in single-digit round trips. */
  it('resolves a 50-item list with relations in a handful of queries', async () => {
    const loaders = createLoaders(ctx.repos);
    ctx.resetQueryCount();

    const page = await ctx.content.list(
      { spaceId: ctx.spaceId, typeIds: [ctx.ids.article as string] },
      { limit: 50, offset: 0 },
    );
    expect(page.items.length).toBe(50);

    // No `await` in the loop, so the loader can batch.
    const assetPromises = page.items.map((row) =>
      row.fields.hero ? loaders.asset.load(row.fields.hero as string) : Promise.resolve(null),
    );
    const relatedPromises = page.items.map((row) =>
      row.fields.related
        ? loaders.content.load(row.fields.related as string)
        : Promise.resolve(null),
    );
    const parentPromises = page.items.map((row) =>
      row.parentId ? loaders.content.load(row.parentId) : Promise.resolve(null),
    );

    const [heroes, relateds] = await Promise.all([
      Promise.all(assetPromises),
      Promise.all(relatedPromises),
      Promise.all(parentPromises),
    ]);

    // 51 articles exist; the shared relation target has no hero.
    const expectedHeroes = page.items.filter((row) => row.fields.hero).length;
    expect(expectedHeroes).toBeGreaterThanOrEqual(49);
    expect(heroes.filter(Boolean)).toHaveLength(expectedHeroes);
    expect(new Set(relateds.filter(Boolean).map((r) => r?.id)).size).toBe(1);

    // 1 list + 1 batched asset read + 1 batched content read.
    expect(ctx.queryCount()).toBeLessThanOrEqual(5);
  });

  it('dedupes repeated ids within one request', async () => {
    const loaders = createLoaders(ctx.repos);
    ctx.resetQueryCount();

    const id = heroIds[0] as string;
    await Promise.all(Array.from({ length: 20 }, () => loaders.asset.load(id)));

    expect(ctx.queryCount()).toBe(1);
  });

  it('loads the children of many parents in one query', async () => {
    const parent = await ctx.content.create({
      spaceId: ctx.spaceId,
      typeId: ctx.ids.article as string,
      locale: 'en',
      title: 'Parent',
      slug: 'parent-batch',
      fields: {},
    });
    for (let i = 0; i < 5; i++) {
      await ctx.content.create({
        spaceId: ctx.spaceId,
        typeId: ctx.ids.article as string,
        locale: 'en',
        parentId: parent.id,
        title: `Kid ${i}`,
        slug: `kid-${i}`,
        fields: {},
      });
    }

    const loaders = createLoaders(ctx.repos);
    ctx.resetQueryCount();
    const children = await loaders.children.load(parent.id);

    expect(children).toHaveLength(5);
    expect(ctx.queryCount()).toBe(1);
  });
});

describe('asset filter relations', () => {
  const settings = { multiple: true, selection: 'filter', accept: ['image/'], limit: 100 };
  const listed = async (publishedAssetsOnly: boolean) => {
    const loaders = createLoaders(ctx.repos, publishedAssetsOnly, {
      spaceId: ctx.spaceId,
      publishedAssetsOnly,
    });
    const result = await loaders.relationQuery.load({
      fieldId: 'gallery',
      target: 'asset',
      settings,
      spaceId: ctx.spaceId,
    });
    return result.items.map((row) => row.id);
  };

  it('lists on public only the assets a published document references', async () => {
    const article = (
      await ctx.content.list(
        { spaceId: ctx.spaceId, typeIds: [ctx.ids.article as string], search: 'Article 7' },
        { limit: 1, offset: 0 },
      )
    ).items[0];
    expect(article?.fields.hero).toBe(heroIds[7]);

    expect(await listed(true)).toEqual([]);
    expect(await listed(false)).toHaveLength(50);

    await ctx.content.publish(ctx.spaceId, article?.id as string);
    expect(await listed(true)).toEqual([heroIds[7]]);
    expect(await listed(false)).toHaveLength(50);

    await ctx.content.unpublish(ctx.spaceId, article?.id as string);
    expect(await listed(true)).toEqual([]);
  });
});
