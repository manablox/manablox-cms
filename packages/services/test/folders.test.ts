import { FOLDER_TYPE_NAME, TEMPLATE_TYPE_NAME } from '@manablox/core';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceContext, type ServiceContext } from '../src/testing.js';
import { TEST_TYPES } from './helpers/types.js';

let ctx: ServiceContext;

beforeAll(async () => {
  ctx = await createServiceContext('folders', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
  });
  // Two locales, so a folder is created twice.
  await ctx.repos.spaces.update(ctx.spaceId, { locales: ['en', 'de'] });
});
afterAll(async () => {
  await ctx?.close();
});

const article = (over: Record<string, unknown> = {}) => ({
  spaceId: ctx.spaceId,
  typeId: ctx.ids.article as string,
  locale: 'en',
  title: 'Hello',
  fields: {},
  ...over,
});

describe('the system types', () => {
  it('are registered in every space without a row of their own', () => {
    const folder = ctx.manablox.contentTypes.getByName(FOLDER_TYPE_NAME);
    const template = ctx.manablox.contentTypes.getByName(TEMPLATE_TYPE_NAME);

    expect(folder.isSystem).toBe(true);
    expect(folder.spaceId).toBeNull();
    expect(folder.hasSlug).toBe(false);
    expect(folder.isPublishable).toBe(false);
    // Delivery reads the published projection.
    expect(template.isPublishable).toBe(true);
    expect(template.isVisibleInTree).toBe(false);
  });
});

describe('folders', () => {
  it('adds no level to the permalink of what it holds', async () => {
    const { primary: folder } = await ctx.content.createFolder(ctx.spaceId, {
      title: 'Campaigns',
      locale: 'en',
    });
    expect(folder.permalink).toBeNull();
    expect(folder.permalinkSegment).toBeNull();

    const page = await ctx.content.create(
      article({ title: 'Spring', slug: 'spring', parentId: folder.id }),
    );
    expect(page.permalink).toBe('spring');

    const child = await ctx.content.create(
      article({ title: 'Week one', slug: 'week-one', parentId: page.id }),
    );
    expect(child.permalink).toBe('spring/week-one');
  });

  it('keeps a page at its address when it is moved into a folder', async () => {
    const { primary: folder } = await ctx.content.createFolder(ctx.spaceId, {
      title: 'Archive',
      locale: 'en',
    });
    const page = await ctx.content.create(article({ title: 'Notes', slug: 'notes' }));
    expect(page.permalink).toBe('notes');

    await ctx.content.move(ctx.spaceId, page.id, folder.id, 0);
    const moved = await ctx.content.get(ctx.spaceId, page.id);
    expect(moved?.permalink).toBe('notes');
  });

  it('is created once per locale, in one localization group', async () => {
    const { primary, rows } = await ctx.content.createFolder(ctx.spaceId, {
      title: 'Guides',
      locale: 'en',
    });

    expect(rows.map((row) => row.locale).sort()).toEqual(['de', 'en']);
    expect(new Set(rows.map((row) => row.localizationId)).size).toBe(1);
    expect(primary.locale).toBe('en');
  });

  it('files a nested folder under the parent translation in each locale', async () => {
    const { primary: parent, rows: parents } = await ctx.content.createFolder(ctx.spaceId, {
      title: 'Regions',
      locale: 'en',
    });
    const { rows } = await ctx.content.createFolder(ctx.spaceId, {
      title: 'North',
      locale: 'en',
      parentId: parent.id,
    });

    const germanParent = parents.find((row) => row.locale === 'de');
    const germanChild = rows.find((row) => row.locale === 'de');
    expect(germanChild?.parentId).toBe(germanParent?.id);
  });

  it('gives a folder a free slug rather than failing on a sibling that holds it', async () => {
    await ctx.content.create(article({ title: 'Press', slug: 'press' }));
    const { primary } = await ctx.content.createFolder(ctx.spaceId, {
      title: 'Press',
      locale: 'en',
    });
    expect(primary.slug).toBe('press-2');
  });
});

describe('a type with no slug', () => {
  const template = (title: string) => ({
    spaceId: ctx.spaceId,
    typeId: ctx.manablox.contentTypes.getByName(TEMPLATE_TYPE_NAME).id,
    locale: 'en',
    title,
    fields: {},
  });

  /** Templates may share a title; the hidden slug must not collide. */
  it('takes a free slug instead of colliding with a sibling', async () => {
    const first = await ctx.content.create(template('Footer'));
    const second = await ctx.content.create(template('Footer'));

    expect(first.slug).toBe('footer');
    expect(second.slug).toBe('footer-2');
    expect(second.permalink).toBeNull();
  });

  it('still refuses a duplicate slug on a type that has one', async () => {
    await ctx.content.create(article({ title: 'Twice', slug: 'twice' }));
    const error = await ctx.content
      .create(article({ title: 'Twice', slug: 'twice' }))
      .catch((e) => e);
    expect(error.details?.[0]?.key).toBe('content.slug.duplicate');
  });
});

describe('the tree', () => {
  it('shows folders and hides documents of a type that is not visible in it', async () => {
    const { primary: folder } = await ctx.content.createFolder(ctx.spaceId, {
      title: 'Visible',
      locale: 'en',
    });
    const page = await ctx.content.create(
      article({ title: 'Under it', slug: 'under-it', parentId: folder.id }),
    );
    const template = await ctx.content.create({
      spaceId: ctx.spaceId,
      typeId: ctx.manablox.contentTypes.getByName(TEMPLATE_TYPE_NAME).id,
      locale: 'en',
      title: 'Footer blocks',
      fields: {},
    });

    const tree = await ctx.content.tree(ctx.spaceId, 'en');
    const ids = new Set<string>();
    const walk = (nodes: Awaited<ReturnType<typeof ctx.content.tree>>) => {
      for (const node of nodes) {
        ids.add(node.content.id);
        walk(node.children);
      }
    };
    walk(tree);

    expect(ids.has(folder.id)).toBe(true);
    expect(ids.has(page.id)).toBe(true);
    expect(ids.has(template.id)).toBe(false);
  });

  it('loads a level at a time, hiding the same types the whole tree does', async () => {
    const { primary: folder } = await ctx.content.createFolder(ctx.spaceId, {
      title: 'Level',
      locale: 'en',
    });
    const page = await ctx.content.create(
      article({ title: 'In it', slug: 'in-it', parentId: folder.id }),
    );
    await ctx.content.create({
      spaceId: ctx.spaceId,
      typeId: ctx.manablox.contentTypes.getByName(TEMPLATE_TYPE_NAME).id,
      locale: 'en',
      title: 'Hidden blocks',
      fields: {},
    });

    const roots = await ctx.content.treeChildren(ctx.spaceId, 'en', null);
    const root = roots.items.find((node) => node.content.id === folder.id);
    expect(root?.childCount).toBe(1);
    // Hidden types are not roots.
    expect(roots.items.some((node) => node.content.title === 'Hidden blocks')).toBe(false);

    const level = await ctx.content.treeChildren(ctx.spaceId, 'en', folder.id);
    expect(level.items.map((node) => node.content.id)).toEqual([page.id]);
    expect(level.total).toBe(1);

    // What the tree opens to reveal the page.
    expect(await ctx.content.ancestorIds(ctx.spaceId, page.id)).toEqual([folder.id]);
  });

  it('finds documents by part of their title, with their ancestors', async () => {
    const { primary: folder } = await ctx.content.createFolder(ctx.spaceId, {
      title: 'Haystack',
      locale: 'en',
    });
    const parent = await ctx.content.create(
      article({ title: 'Barn', slug: 'barn', parentId: folder.id }),
    );
    const needle = await ctx.content.create(
      article({ title: 'Golden needle', slug: 'golden-needle', parentId: parent.id }),
    );

    const result = await ctx.content.treeSearch(ctx.spaceId, 'en', 'eedl');
    const byId = new Map(result.nodes.map((node) => [node.content.id, node]));

    expect(result.total).toBe(1);
    expect(byId.get(needle.id)).toMatchObject({ match: true, parentId: parent.id });
    expect(byId.get(parent.id)).toMatchObject({ match: false, parentId: folder.id });
    expect(byId.get(folder.id)).toMatchObject({ match: false, parentId: null });

    // Folders never match when only articles may.
    const onlyArticles = await ctx.content.treeSearch(ctx.spaceId, 'en', 'haystack', {
      matchTypeIds: [ctx.ids.article as string],
    });
    expect(onlyArticles.nodes).toEqual([]);
    expect((await ctx.content.treeSearch(ctx.spaceId, 'en', 'haystack')).total).toBe(1);
  });

  it('pages a long level', async () => {
    const { primary: folder } = await ctx.content.createFolder(ctx.spaceId, {
      title: 'Long',
      locale: 'en',
    });
    for (let index = 0; index < 4; index++) {
      await ctx.content.create(
        article({ title: `Page ${index}`, slug: `long-${index}`, parentId: folder.id }),
      );
    }

    const first = await ctx.content.treeChildren(ctx.spaceId, 'en', folder.id, { limit: 3 });
    expect(first.items).toHaveLength(3);
    expect(first.total).toBe(4);

    const rest = await ctx.content.treeChildren(ctx.spaceId, 'en', folder.id, {
      limit: 3,
      offset: 3,
    });
    expect(rest.items).toHaveLength(1);
  });
});
