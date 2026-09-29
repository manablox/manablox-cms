import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceContext, type ServiceContext } from '../src/testing.js';
import { TEST_TYPES } from './helpers/types.js';

let ctx: ServiceContext;

beforeAll(async () => {
  ctx = await createServiceContext('tag', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
  });
});
afterAll(async () => {
  await ctx?.close();
});

const document = (title: string, fields: Record<string, unknown> = {}) =>
  ctx.content.create({
    spaceId: ctx.spaceId,
    typeId: ctx.ids.article as string,
    locale: 'en',
    title,
    slug: title.toLowerCase().replace(/\s+/g, '-'),
    fields,
  });

const asset = (name: string) =>
  ctx.repos.assets.create({
    spaceId: ctx.spaceId,
    driver: 'local',
    key: `k/${name}`,
    filename: `${name}.jpg`,
    name,
    mimeType: 'image/jpeg',
    size: 10,
  });

describe('the vocabulary', () => {
  it('creates a tag once, however it is spelled', async () => {
    const [first] = await ctx.tags.ensure(ctx.spaceId, ['Long Read']);
    const [again] = await ctx.tags.ensure(ctx.spaceId, ['  long   read  ']);
    expect(again?.id).toBe(first?.id);
    expect(first?.slug).toBe('long-read');
    // The first spelling is the name; a later one does not rewrite it.
    expect(again?.name).toBe('Long Read');
  });

  it('refuses a rename onto another tag, and allows one onto itself', async () => {
    const [source] = await ctx.tags.ensure(ctx.spaceId, ['Interview']);
    await ctx.tags.ensure(ctx.spaceId, ['Opinion']);
    await expect(
      ctx.tags.rename(ctx.spaceId, source?.id as string, 'Opinion'),
    ).rejects.toMatchObject({ key: 'tag.name.taken' });

    const renamed = await ctx.tags.rename(ctx.spaceId, source?.id as string, 'Interviews');
    expect(renamed.slug).toBe('interviews');
  });

  it('counts what carries each tag', async () => {
    const doc = await document('Counted');
    const file = await asset('counted');
    await ctx.tags.setForContent(ctx.spaceId, doc.localizationId, ['Counting']);
    await ctx.tags.setForAsset(ctx.spaceId, file.id, ['Counting']);

    const counted = (await ctx.tags.listWithCounts(ctx.spaceId, 'Counting'))[0];
    expect(counted?.contentCount).toBe(1);
    expect(counted?.assetCount).toBe(1);
  });
});

describe('assignments', () => {
  it('gives every translation of a document the same tags', async () => {
    const en = await document('Shared');
    const de = await ctx.content.create({
      spaceId: ctx.spaceId,
      typeId: ctx.ids.article as string,
      locale: 'de',
      localizationId: en.localizationId,
      title: 'Geteilt',
      slug: 'geteilt',
      fields: {},
    });

    await ctx.tags.setForContent(ctx.spaceId, en.localizationId, ['Travel']);
    const byGroup = await ctx.tags.ofContent([de.localizationId]);
    expect(byGroup.get(de.localizationId)?.map((tag) => tag.name)).toEqual(['Travel']);
  });

  it('replaces the whole set, keeping the tag itself', async () => {
    const doc = await document('Replaced');
    await ctx.tags.setForContent(ctx.spaceId, doc.localizationId, ['Keep', 'Drop']);
    await ctx.tags.setForContent(ctx.spaceId, doc.localizationId, ['Keep']);

    const byGroup = await ctx.tags.ofContent([doc.localizationId]);
    expect(byGroup.get(doc.localizationId)?.map((tag) => tag.name)).toEqual(['Keep']);
    expect((await ctx.tags.list(ctx.spaceId, 'Drop')).length).toBe(1);
  });

  it('forgets a document tag set only once its last translation is gone', async () => {
    const en = await document('Ephemeral');
    const de = await ctx.content.create({
      spaceId: ctx.spaceId,
      typeId: ctx.ids.article as string,
      locale: 'de',
      localizationId: en.localizationId,
      title: 'Kurzlebig',
      slug: 'kurzlebig',
      fields: {},
    });
    await ctx.tags.setForContent(ctx.spaceId, en.localizationId, ['Temporary']);

    await ctx.content.delete(ctx.spaceId, de.id);
    expect((await ctx.tags.ofContent([en.localizationId])).get(en.localizationId)).toHaveLength(1);

    await ctx.content.delete(ctx.spaceId, en.id);
    expect((await ctx.tags.ofContent([en.localizationId])).get(en.localizationId)).toBeUndefined();
  });

  it('merges a tag into another, taking documents and assets along', async () => {
    const doc = await document('Merged');
    const file = await asset('merged');
    const [source] = await ctx.tags.ensure(ctx.spaceId, ['Foto']);
    const [target] = await ctx.tags.ensure(ctx.spaceId, ['Photo']);
    await ctx.tags.setForContent(ctx.spaceId, doc.localizationId, ['Foto']);
    await ctx.tags.setForAsset(ctx.spaceId, file.id, ['Foto']);

    await ctx.tags.merge(ctx.spaceId, source?.id as string, target?.id as string);

    expect(await ctx.repos.tags.findById(source?.id as string, ctx.spaceId)).toBeNull();
    expect((await ctx.tags.ofContent([doc.localizationId])).get(doc.localizationId)).toEqual([
      expect.objectContaining({ id: target?.id }),
    ]);
    expect((await ctx.tags.ofAssets([file.id], ctx.spaceId)).get(file.id)).toEqual([
      expect.objectContaining({ id: target?.id }),
    ]);
  });

  it('keeps one row when both tags of a merge are on the same document', async () => {
    const doc = await document('Both');
    const [source] = await ctx.tags.ensure(ctx.spaceId, ['Cycling']);
    const [target] = await ctx.tags.ensure(ctx.spaceId, ['Sport']);
    await ctx.tags.setForContent(ctx.spaceId, doc.localizationId, ['Cycling', 'Sport']);

    await ctx.tags.merge(ctx.spaceId, source?.id as string, target?.id as string);
    expect((await ctx.tags.ofContent([doc.localizationId])).get(doc.localizationId)).toHaveLength(
      1,
    );
  });
});

describe('search', () => {
  it('finds documents by tag id and by the tag name in a free-text search', async () => {
    const doc = await document('Untagged title');
    await ctx.tags.setForContent(ctx.spaceId, doc.localizationId, ['Okapi']);
    const [tag] = await ctx.tags.list(ctx.spaceId, 'Okapi');

    const byId = await ctx.content.list(
      { spaceId: ctx.spaceId, tagIds: [tag?.id as string] },
      { limit: 10, offset: 0 },
    );
    expect(byId.items.map((row) => row.id)).toEqual([doc.id]);

    const byText = await ctx.content.list(
      { spaceId: ctx.spaceId, search: 'okapi' },
      { limit: 10, offset: 0 },
    );
    expect(byText.items.map((row) => row.id)).toContain(doc.id);
  });

  it('finds assets by tag id and by the tag name', async () => {
    const file = await asset('plain-name');
    await ctx.tags.setForAsset(ctx.spaceId, file.id, ['Sunset']);
    const [tag] = await ctx.tags.list(ctx.spaceId, 'Sunset');

    const byId = await ctx.repos.assets.page(
      { spaceId: ctx.spaceId, tagIds: [tag?.id as string] },
      { limit: 10, offset: 0 },
    );
    expect(byId.items.map((row) => row.id)).toEqual([file.id]);

    const byText = await ctx.repos.assets.page(
      { spaceId: ctx.spaceId, search: 'sunset' },
      { limit: 10, offset: 0 },
    );
    expect(byText.items.map((row) => row.id)).toEqual([file.id]);
  });
});
