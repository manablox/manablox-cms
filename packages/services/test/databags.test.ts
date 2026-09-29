import { defineContentType } from '@manablox/core';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceContext, type ServiceContext } from '../src/testing.js';
import { TEST_TYPES } from './helpers/types.js';

let ctx: ServiceContext;

beforeAll(async () => {
  ctx = await createServiceContext('databags', {
    fieldTypes: builtinFieldTypes,
    contentTypes: [
      ...TEST_TYPES,
      {
        name: 'product',
        kind: 'data',
        fields: [
          { name: 'sku', type: 'string', unique: true },
          { name: 'price', type: 'number' },
        ],
      },
      { name: 'landing', fields: [{ name: 'form', type: 'databag' }] },
    ],
  });
});
afterAll(async () => {
  await ctx?.close();
});

const product = (over: Record<string, unknown> = {}) => ({
  spaceId: ctx.spaceId,
  typeId: ctx.ids.product as string,
  locale: 'en',
  title: 'Widget',
  fields: {},
  ...over,
});

const article = (over: Record<string, unknown> = {}) => ({
  spaceId: ctx.spaceId,
  typeId: ctx.ids.article as string,
  locale: 'en',
  title: 'Hello',
  fields: {},
  ...over,
});

describe('a databag type', () => {
  it('has no slug, tree or menu place, but can be published', () => {
    const type = ctx.manablox.contentTypes.get(ctx.ids.product as string);
    expect(type.kind).toBe('data');
    expect(type.hasSlug).toBe(false);
    expect(type.isVisibleInTree).toBe(false);
    expect(type.canBeVisibleInMenu).toBe(false);
    expect(type.isPublishable).toBe(true);
  });

  it('rejects the flags of a routed document', () => {
    expect(() =>
      defineContentType({ name: 'faq', kind: 'data', hasSlug: true, fields: [] }),
    ).toThrow(expect.objectContaining({ key: 'contentType.data.flagsNotAllowed' }));
  });

  it('keeps its kind when an update claims another', async () => {
    const created = await ctx.contentTypes.create({
      name: 'member',
      kind: 'data',
      spaceId: ctx.spaceId,
      fields: [{ name: 'role', type: 'string' }],
    });
    const updated = await ctx.contentTypes.update(ctx.spaceId, created.id, {
      name: 'member',
      kind: 'content',
      spaceId: ctx.spaceId,
      fields: created.fields,
    });
    expect(updated.kind).toBe('data');
    expect(updated.hasSlug).toBe(false);
    expect(updated.isVisibleInTree).toBe(false);
  });
});

describe('databag entries', () => {
  it('stay at the root without a permalink and out of the tree', async () => {
    const entry = await ctx.content.create(product({ title: 'Lamp', fields: { sku: 'L-1' } }));
    expect(entry.parentId).toBeNull();
    expect(entry.permalink).toBeNull();

    const page = await ctx.content.create(article({ title: 'Home', slug: 'home' }));
    const tree = await ctx.content.tree(ctx.spaceId, 'en');
    const ids = tree.map((node) => node.content.id);
    expect(ids).toContain(page.id);
    expect(ids).not.toContain(entry.id);

    const roots = await ctx.content.treeChildren(ctx.spaceId, 'en', null);
    expect(roots.items.some((node) => node.content.id === entry.id)).toBe(false);
  });

  it('never get a parent', async () => {
    const page = await ctx.content.create(article({ title: 'Shop', slug: 'shop' }));
    await expect(ctx.content.create(product({ parentId: page.id }))).rejects.toMatchObject({
      key: 'content.data.hasParent',
    });

    const entry = await ctx.content.create(product({ title: 'Chair' }));
    await expect(ctx.content.move(ctx.spaceId, entry.id, page.id, 0)).rejects.toMatchObject({
      key: 'content.data.hasParent',
    });
    await expect(
      ctx.content.update(ctx.spaceId, entry.id, product({ title: 'Chair', parentId: page.id })),
    ).rejects.toMatchObject({ key: 'content.data.hasParent' });
  });

  it('never hold children', async () => {
    const entry = await ctx.content.create(product({ title: 'Desk' }));
    await expect(
      ctx.content.create(article({ title: 'Under', slug: 'under', parentId: entry.id })),
    ).rejects.toMatchObject({ key: 'content.parent.isData' });

    const page = await ctx.content.create(article({ title: 'Loose', slug: 'loose' }));
    await expect(ctx.content.move(ctx.spaceId, page.id, entry.id, 0)).rejects.toMatchObject({
      key: 'content.parent.isData',
    });
  });

  it('are listed by type, searched and paged', async () => {
    for (let index = 0; index < 3; index++) {
      await ctx.content.create(product({ title: `Shelf ${index}`, fields: { sku: `S-${index}` } }));
    }
    const typeIds = [ctx.ids.product as string];

    const all = await ctx.content.list({ spaceId: ctx.spaceId, typeIds }, { limit: 2, offset: 0 });
    expect(all.items).toHaveLength(2);
    expect(all.items.every((row) => row.typeId === ctx.ids.product)).toBe(true);

    const shelves = await ctx.content.list(
      { spaceId: ctx.spaceId, typeIds, search: 'shelf' },
      { limit: 2, offset: 2 },
      [{ by: 'title', direction: 'asc' }],
    );
    expect(shelves.total).toBe(3);
    expect(shelves.items.map((row) => row.title)).toEqual(['Shelf 2']);
  });

  it('enforce unique fields and publish like documents', async () => {
    const entry = await ctx.content.create(product({ title: 'Stool', fields: { sku: 'ST-1' } }));
    await expect(
      ctx.content.create(product({ title: 'Stool copy', fields: { sku: 'ST-1' } })),
    ).rejects.toMatchObject({ key: 'content.validation.failed' });

    await ctx.content.publish(ctx.spaceId, entry.id);
    const published = await ctx.content.get(ctx.spaceId, entry.id, { published: true });
    expect(published?.title).toBe('Stool');
  });
});

describe('a databag field', () => {
  const landing = (form: unknown) => ({
    spaceId: ctx.spaceId,
    typeId: ctx.ids.landing as string,
    locale: 'en',
    title: 'Landing',
    slug: `landing-${crypto.randomUUID().slice(0, 8)}`,
    fields: { form },
  });

  it('holds a databag type, or nothing', async () => {
    const row = await ctx.content.create(landing(ctx.ids.product));
    expect(row.fields.form).toBe(ctx.ids.product);
    const empty = await ctx.content.create(landing(null));
    expect(empty.fields.form).toBeNull();
  });

  it('refuses document types and unknown ids', async () => {
    for (const id of [ctx.ids.article, crypto.randomUUID()]) {
      await expect(ctx.content.create(landing(id))).rejects.toMatchObject({
        details: [expect.objectContaining({ key: 'field.databag.notFound', path: ['form'] })],
      });
    }
  });
});
