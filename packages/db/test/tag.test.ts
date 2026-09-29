import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { batches } from '../src/batch.js';
import { TAG_LIST_LIMIT } from '../src/pagination.js';
import { TagRepository } from '../src/repositories/tag.js';
import {
  createRepositoryContext,
  makeNode,
  type RepositoryTestContext,
} from './helpers/repository.js';

let ctx: RepositoryTestContext;
let otherSpaceId: string;

beforeAll(async () => {
  ctx = await createRepositoryContext('tag');
  otherSpaceId = (
    await ctx.repos.spaces.create({ name: 'Other', machineName: 'other', url: 'http://o.test' })
  ).id;
});
afterAll(async () => {
  await ctx?.close();
});

let counter = 0;
const unique = (base: string) => `${base}-${++counter}`;

/** Tags in a fresh space, so listings see only this test's rows. */
const freshSpace = async () => {
  const name = unique('space');
  return (await ctx.repos.spaces.create({ name, machineName: name, url: 'http://t.test' })).id;
};

const tag = async (name: string, spaceId = ctx.spaceId) => {
  const [row] = await ctx.repos.tags.ensure(spaceId, [{ name, slug: name.toLowerCase() }]);
  if (!row) throw new Error('tag not created');
  return row;
};

const asset = (spaceId = ctx.spaceId) => {
  const name = unique('file');
  return ctx.repos.assets.create({
    spaceId,
    driver: 'local',
    key: `k/${name}`,
    filename: name,
    name,
    mimeType: 'image/png',
    size: 1,
    checksum: name,
  });
};

describe('tags.ensure', () => {
  it('inserts missing tags, keeps existing ones and returns every requested tag', async () => {
    const spaceId = await freshSpace();
    const [news] = await ctx.repos.tags.ensure(spaceId, [{ name: 'News', slug: 'news' }]);
    const rows = await ctx.repos.tags.ensure(spaceId, [
      { name: 'News again', slug: 'news' },
      { name: 'Sport', slug: 'sport' },
    ]);
    expect(rows.map((row) => row.slug).sort()).toEqual(['news', 'sport']);
    // The existing row wins; its name is not overwritten.
    expect(rows.find((row) => row.slug === 'news')).toMatchObject({ id: news?.id, name: 'News' });
  });

  it('collapses duplicate slugs in one call and returns nothing for no input', async () => {
    const spaceId = await freshSpace();
    const rows = await ctx.repos.tags.ensure(spaceId, [
      { name: 'A', slug: 'a' },
      { name: 'a', slug: 'a' },
    ]);
    expect(rows).toHaveLength(1);
    expect(await ctx.repos.tags.ensure(spaceId, [])).toEqual([]);
  });

  it('keeps the same slug apart per space', async () => {
    const here = await tag('Shared');
    const there = await tag('Shared', otherSpaceId);
    expect(here.id).not.toBe(there.id);
  });

  it('writes and reads 2000 tags in one statement each', async () => {
    const spaceId = await freshSpace();
    const inputs = Array.from({ length: 2000 }, (_, index) => ({
      name: `Bulk ${index}`,
      slug: `bulk-${index}`,
    }));
    ctx.queries.length = 0;
    expect(await ctx.repos.tags.ensure(spaceId, inputs)).toHaveLength(2000);
    expect(ctx.queries).toHaveLength(2);

    ctx.queries.length = 0;
    const slugs = inputs.map((input) => input.slug);
    expect(await ctx.repos.tags.listBySlugs(spaceId, slugs)).toHaveLength(2000);
    expect(ctx.queries).toHaveLength(1);
  });

  it('splits 2000 tags into statements under the parameter ceiling', async () => {
    const spaceId = await freshSpace();
    const dialect = Object.create(ctx.handle.dialect, { maxParameters: { value: 1024 } });
    const tags = new TagRepository({ ...ctx.handle, dialect });
    const inputs = Array.from({ length: 2000 }, (_, index) => ({
      name: `Split ${index}`,
      slug: `split-${index}`,
    }));
    const inserts = batches(inputs, 7, 1024).length;
    const selects = batches(inputs, 1, 1024).length;

    ctx.queries.length = 0;
    const rows = await tags.ensure(spaceId, inputs);
    expect(new Set(rows.map((row) => row.slug)).size).toBe(2000);
    expect(ctx.queries).toHaveLength(inserts + selects);
    expect(inserts).toBeGreaterThan(1);
    expect(selects).toBeGreaterThan(1);

    // A second pass inserts nothing new and still returns every tag.
    expect(await tags.ensure(spaceId, inputs)).toHaveLength(2000);
    expect(await ctx.repos.tags.listBySpace(spaceId, undefined, 5000)).toHaveLength(2000);
  });
});

describe('tags.listBySpace', () => {
  it('lists alphabetically and only the space asked for', async () => {
    const spaceId = await freshSpace();
    await ctx.repos.tags.ensure(spaceId, [
      { name: 'zeta', slug: 'zeta' },
      { name: 'alpha', slug: 'alpha' },
      { name: 'mid', slug: 'mid' },
    ]);
    await tag('outsider', otherSpaceId);
    const rows = await ctx.repos.tags.listBySpace(spaceId);
    expect(rows.map((row) => row.name)).toEqual(['alpha', 'mid', 'zeta']);
  });

  it('matches the search case-insensitively and treats wildcards literally', async () => {
    const spaceId = await freshSpace();
    await ctx.repos.tags.ensure(spaceId, [
      { name: 'Summer Sale', slug: 'summer-sale' },
      { name: '100% cotton', slug: '100-cotton' },
      { name: 'Winter', slug: 'winter' },
    ]);
    expect((await ctx.repos.tags.listBySpace(spaceId, 'sale')).map((row) => row.name)).toEqual([
      'Summer Sale',
    ]);
    expect((await ctx.repos.tags.listBySpace(spaceId, '%')).map((row) => row.name)).toEqual([
      '100% cotton',
    ]);
    expect(await ctx.repos.tags.listBySpace(spaceId, '_')).toEqual([]);
  });

  it('caps the listing at the given limit, TAG_LIST_LIMIT by default', async () => {
    const spaceId = await freshSpace();
    const inputs = Array.from({ length: TAG_LIST_LIMIT + 1 }, (_, index) => {
      const name = `t${String(index).padStart(4, '0')}`;
      return { name, slug: name };
    });
    await ctx.repos.tags.ensure(spaceId, inputs);
    const all = await ctx.repos.tags.listBySpace(spaceId);
    expect(all).toHaveLength(TAG_LIST_LIMIT);
    expect(all[0]?.name).toBe('t0000');
    expect(await ctx.repos.tags.listBySpace(spaceId, undefined, 3)).toHaveLength(3);
  });
});

describe('tags lookups', () => {
  it('finds by id only inside its space', async () => {
    const row = await tag(unique('find'));
    expect((await ctx.repos.tags.findById(row.id, ctx.spaceId))?.id).toBe(row.id);
    expect(await ctx.repos.tags.findById(row.id, otherSpaceId)).toBeNull();
  });

  it('listByIds drops unknown ids and ids of other spaces', async () => {
    const mine = await tag(unique('mine'));
    const theirs = await tag(unique('theirs'), otherSpaceId);
    const rows = await ctx.repos.tags.listByIds(
      [mine.id, theirs.id, '00000000-0000-4000-8000-000000000000'],
      ctx.spaceId,
    );
    expect(rows.map((row) => row.id)).toEqual([mine.id]);
    expect(await ctx.repos.tags.listByIds([], ctx.spaceId)).toEqual([]);
  });

  it('listBySlugs is scoped by space and empty for no slugs', async () => {
    const name = unique('slugged');
    const row = await tag(name);
    await tag(name, otherSpaceId);
    const rows = await ctx.repos.tags.listBySlugs(ctx.spaceId, [name.toLowerCase(), 'missing']);
    expect(rows.map((found) => found.id)).toEqual([row.id]);
    expect(await ctx.repos.tags.listBySlugs(ctx.spaceId, [])).toEqual([]);
  });
});

describe('tags writes', () => {
  it('update renames within the space and refuses another space', async () => {
    const row = await tag(unique('before'));
    const renamed = await ctx.repos.tags.update(row.id, ctx.spaceId, {
      name: 'After',
      slug: unique('after'),
    });
    expect(renamed).toMatchObject({ id: row.id, name: 'After' });
    await expect(
      ctx.repos.tags.update(row.id, otherSpaceId, { name: 'X', slug: 'x' }),
    ).rejects.toMatchObject({ key: 'tag.notFound', kind: 'not_found' });
  });

  it('delete answers whether a row went, and never crosses spaces', async () => {
    const row = await tag(unique('doomed'));
    expect(await ctx.repos.tags.delete(row.id, otherSpaceId)).toBe(false);
    expect(await ctx.repos.tags.delete(row.id, ctx.spaceId)).toBe(true);
    expect(await ctx.repos.tags.delete(row.id, ctx.spaceId)).toBe(false);
    expect(await ctx.repos.tags.findById(row.id, ctx.spaceId)).toBeNull();
  });
});

describe('tag assignments', () => {
  it('setForLocalization replaces a document tags and an empty list clears them', async () => {
    const doc = await makeNode(ctx, { title: 'Doc', slug: unique('doc') });
    const [a, b, c] = await Promise.all([tag('Bravo'), tag('Alpha'), tag('Charlie')]);

    await ctx.repos.tags.setForLocalization(ctx.spaceId, doc.localizationId, [a.id, b.id]);
    let byGroup = await ctx.repos.tags.listByLocalizations([doc.localizationId]);
    expect(byGroup.get(doc.localizationId)?.map((row) => row.name)).toEqual(['Alpha', 'Bravo']);

    await ctx.repos.tags.setForLocalization(ctx.spaceId, doc.localizationId, [c.id]);
    byGroup = await ctx.repos.tags.listByLocalizations([doc.localizationId]);
    expect(byGroup.get(doc.localizationId)?.map((row) => row.name)).toEqual(['Charlie']);

    await ctx.repos.tags.setForLocalization(ctx.spaceId, doc.localizationId, []);
    byGroup = await ctx.repos.tags.listByLocalizations([doc.localizationId]);
    expect(byGroup.has(doc.localizationId)).toBe(false);
    expect((await ctx.repos.tags.listByLocalizations([])).size).toBe(0);
  });

  it('setForAsset leaves the tags of other spaces on the asset', async () => {
    const file = await asset();
    const mine = await tag(unique('asset-mine'));
    const theirs = await tag(unique('asset-theirs'), otherSpaceId);
    await ctx.repos.tags.setForAsset(file.id, otherSpaceId, [theirs.id]);
    await ctx.repos.tags.setForAsset(file.id, ctx.spaceId, [mine.id]);

    const all = await ctx.repos.tags.listByAssets([file.id]);
    expect(
      all
        .get(file.id)
        ?.map((row) => row.id)
        .sort(),
    ).toEqual([mine.id, theirs.id].sort());
    const scoped = await ctx.repos.tags.listByAssets([file.id], ctx.spaceId);
    expect(scoped.get(file.id)?.map((row) => row.id)).toEqual([mine.id]);

    await ctx.repos.tags.setForAsset(file.id, ctx.spaceId, []);
    const after = await ctx.repos.tags.listByAssets([file.id]);
    expect(after.get(file.id)?.map((row) => row.id)).toEqual([theirs.id]);
  });

  it('listBySpaceWithCounts counts documents and assets per tag', async () => {
    const spaceId = await freshSpace();
    const created = await ctx.repos.tags.ensure(spaceId, [
      { name: 'Used', slug: 'used' },
      { name: 'Idle', slug: 'idle' },
    ]);
    // `ensure` returns the tags in no particular order.
    const used = created.find((row) => row.slug === 'used');
    if (!used) throw new Error('tag missing');
    const file = await asset(spaceId);
    await ctx.repos.tags.seedForLocalizations([
      { tagId: used.id, localizationId: crypto.randomUUID(), spaceId },
      { tagId: used.id, localizationId: crypto.randomUUID(), spaceId },
    ]);
    await ctx.repos.tags.seedForAssets([{ tagId: used.id, assetId: file.id }]);

    const rows = await ctx.repos.tags.listBySpaceWithCounts(spaceId);
    expect(rows.map((row) => [row.name, row.contentCount, row.assetCount])).toEqual([
      ['Idle', 0, 0],
      ['Used', 2, 1],
    ]);
    expect(await ctx.repos.tags.listBySpaceWithCounts(spaceId, 'nothing')).toEqual([]);
  });

  it('seeding keeps existing assignments and ignores duplicates', async () => {
    const row = await tag(unique('seed'));
    const localizationId = crypto.randomUUID();
    const seed = [{ tagId: row.id, localizationId, spaceId: ctx.spaceId }];
    await ctx.repos.tags.seedForLocalizations(seed);
    await ctx.repos.tags.seedForLocalizations(seed);
    expect(
      (await ctx.repos.tags.listByLocalizations([localizationId])).get(localizationId),
    ).toEqual([expect.objectContaining({ id: row.id })]);
  });

  it('merge moves every assignment onto the target and drops the source', async () => {
    const source = await tag(unique('source'));
    const target = await tag(unique('target'));
    const both = crypto.randomUUID();
    const sourceOnly = crypto.randomUUID();
    const file = await asset();
    await ctx.repos.tags.seedForLocalizations([
      { tagId: source.id, localizationId: both, spaceId: ctx.spaceId },
      { tagId: target.id, localizationId: both, spaceId: ctx.spaceId },
      { tagId: source.id, localizationId: sourceOnly, spaceId: ctx.spaceId },
    ]);
    await ctx.repos.tags.seedForAssets([{ tagId: source.id, assetId: file.id }]);

    await ctx.repos.tags.merge(source.id, target.id, ctx.spaceId);

    const groups = await ctx.repos.tags.listByLocalizations([both, sourceOnly]);
    expect(groups.get(both)?.map((row) => row.id)).toEqual([target.id]);
    expect(groups.get(sourceOnly)?.map((row) => row.id)).toEqual([target.id]);
    expect((await ctx.repos.tags.listByAssets([file.id])).get(file.id)?.map((r) => r.id)).toEqual([
      target.id,
    ]);
    expect(await ctx.repos.tags.findById(source.id, ctx.spaceId)).toBeNull();
  });

  it('deleteByLocalizations answers whether anything was removed', async () => {
    const row = await tag(unique('gone'));
    const localizationId = crypto.randomUUID();
    await ctx.repos.tags.seedForLocalizations([
      { tagId: row.id, localizationId, spaceId: ctx.spaceId },
    ]);
    expect(await ctx.repos.tags.deleteByLocalizations([localizationId])).toBe(true);
    expect(await ctx.repos.tags.deleteByLocalizations([localizationId])).toBe(false);
    expect(await ctx.repos.tags.deleteByLocalizations([])).toBe(false);
  });
});
