import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceContext, type ServiceContext } from '../src/testing.js';
import { TEST_TYPES } from './helpers/types.js';

let ctx: ServiceContext;

beforeAll(async () => {
  ctx = await createServiceContext('menu', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
  });
});
afterAll(async () => {
  await ctx?.close();
});

const document = (title: string, over: Record<string, unknown> = {}) =>
  ctx.content.create({
    spaceId: ctx.spaceId,
    typeId: ctx.ids.article as string,
    locale: 'en',
    title,
    fields: {},
    ...over,
  });

describe('menus', () => {
  it('names a taken machine name on the field rather than failing with a 500', async () => {
    await ctx.menus.create({ spaceId: ctx.spaceId, name: 'Main', machineName: 'main' });
    const error = await ctx.menus
      .create({ spaceId: ctx.spaceId, name: 'Main again', machineName: 'main' })
      .catch((err) => err);
    expect(error.key).toBe('menu.validation.failed');
    expect(error.details).toEqual([
      { key: 'menu.machineName.taken', path: ['machineName'], params: { machineName: 'main' } },
    ]);
  });

  it('refuses a menu of another space as not found', async () => {
    const other = await ctx.repos.spaces.create({ name: 'O', machineName: 'o', url: 'http://o' });
    const menu = await ctx.menus.create({ spaceId: other.id, name: 'Other', machineName: 'other' });
    await expect(ctx.menus.get(ctx.spaceId, menu.id, 'en')).rejects.toMatchObject({
      key: 'menu.notFound',
    });
    await expect(ctx.menus.update(ctx.spaceId, menu.id, { name: 'X' })).rejects.toMatchObject({
      key: 'menu.notFound',
    });
  });

  describe('setItems', () => {
    it('reports every malformed entry at once, at its position in the tree', async () => {
      const menu = await ctx.menus.create({
        spaceId: ctx.spaceId,
        name: 'Nav',
        machineName: 'nav',
      });
      const error = await ctx.menus
        .setItems(ctx.spaceId, menu.id, [
          { url: 'https://example.test', children: [{ label: 'Nowhere' }] },
        ])
        .catch((err) => err);
      expect(error.key).toBe('menu.validation.failed');
      expect(error.details).toEqual([
        { key: 'menu.item.linkNeedsLabel', path: ['items', 0] },
        { key: 'menu.item.targetRequired', path: ['items', 0, 'children', 0] },
      ]);
    });

    it('refuses an entry naming a document the space does not have', async () => {
      const menu = await ctx.menus.create({
        spaceId: ctx.spaceId,
        name: 'Nav2',
        machineName: 'nav2',
      });
      const stranger = crypto.randomUUID();
      const error = await ctx.menus
        .setItems(ctx.spaceId, menu.id, [{ localizationId: stranger }])
        .catch((err) => err);
      expect(error.details).toEqual([
        {
          key: 'menu.item.contentNotFound',
          path: ['items', 0],
          params: { localizationId: stranger },
        },
      ]);
    });

    it('stores a valid tree and resolves it per locale, with one lookup for the documents', async () => {
      const menu = await ctx.menus.create({
        spaceId: ctx.spaceId,
        name: 'Nav3',
        machineName: 'nav3',
      });
      const home = await document('Home', { slug: 'home' });
      const about = await document('About', { slug: 'about' });
      await ctx.content.createTranslation(ctx.spaceId, about.id, 'de');

      ctx.resetQueryCount();
      const tree = await ctx.menus.setItems(ctx.spaceId, menu.id, [
        { localizationId: home.localizationId },
        {
          localizationId: about.localizationId,
          children: [{ url: 'https://jobs.example', label: 'Jobs' }],
        },
      ]);
      // Must not grow with the number of entries.
      expect(ctx.queryCount()).toBeLessThanOrEqual(18);
      expect(tree).toHaveLength(2);

      const de = await ctx.menus.get(ctx.spaceId, menu.id, 'de');
      expect(de.items.map((item) => item.content?.title ?? null)).toEqual([null, 'About']);
    });
  });

  describe('forgetContent', () => {
    it("removes a document's entries from every menu, sub-entries included", async () => {
      const first = await ctx.menus.create({ spaceId: ctx.spaceId, name: 'F1', machineName: 'f1' });
      const second = await ctx.menus.create({
        spaceId: ctx.spaceId,
        name: 'F2',
        machineName: 'f2',
      });
      const gone = await document('Gone', { slug: 'gone' });
      const kept = await document('Kept', { slug: 'kept' });
      await ctx.menus.setItems(ctx.spaceId, first.id, [
        { localizationId: gone.localizationId, children: [{ url: '/x', label: 'X' }] },
        { localizationId: kept.localizationId },
      ]);
      await ctx.menus.setItems(ctx.spaceId, second.id, [{ localizationId: gone.localizationId }]);

      await ctx.menus.forgetContent(ctx.spaceId, gone.localizationId);

      const tree1 = await ctx.repos.menus.listItemTree(first.id);
      expect(tree1.map((node) => node.item.localizationId)).toEqual([kept.localizationId]);
      expect(await ctx.repos.menus.listItemTree(second.id)).toEqual([]);
    });

    it('is triggered by deleting the last translation, not the first', async () => {
      const menu = await ctx.menus.create({ spaceId: ctx.spaceId, name: 'F3', machineName: 'f3' });
      const en = await document('Bilingual', { slug: 'bilingual' });
      const de = await ctx.content.createTranslation(ctx.spaceId, en.id, 'de');
      await ctx.menus.setItems(ctx.spaceId, menu.id, [{ localizationId: en.localizationId }]);

      await ctx.content.delete(ctx.spaceId, de.id);
      expect(await ctx.repos.menus.listItemTree(menu.id)).toHaveLength(1);

      await ctx.content.delete(ctx.spaceId, en.id);
      expect(await ctx.repos.menus.listItemTree(menu.id)).toEqual([]);
    });
  });

  describe('placements', () => {
    const spotIn = async (localizationId: string, menuId: string) => {
      const options = await ctx.menus.placements(ctx.spaceId, localizationId, 'en');
      return options.find((option) => option.menu.id === menuId);
    };

    it('reports where a document sits, counting siblings without its own entry', async () => {
      const menu = await ctx.menus.create({ spaceId: ctx.spaceId, name: 'P1', machineName: 'p1' });
      const parent = await document('Parent', { slug: 'p1-parent' });
      const child = await document('Child', { slug: 'p1-child' });
      await ctx.menus.setItems(ctx.spaceId, menu.id, [
        {
          localizationId: parent.localizationId,
          children: [{ url: '/a', label: 'A' }, { localizationId: child.localizationId }],
        },
      ]);

      const option = await spotIn(child.localizationId, menu.id);
      expect(option?.placement).toEqual({
        parentId: (await ctx.repos.menus.listItemTree(menu.id))[0]?.item.id,
        index: 1,
      });
      expect(option?.entries.map((entry) => [entry.label, entry.depth, entry.isSelf])).toEqual([
        ['Parent', 0, false],
        ['A', 1, false],
        ['Child', 1, true],
      ]);

      const absent = await spotIn(parent.localizationId, menu.id);
      expect(absent?.placement).toEqual({ parentId: null, index: 0 });
    });

    it('adds a document at the chosen spot and keeps the entry id when it moves', async () => {
      const menu = await ctx.menus.create({ spaceId: ctx.spaceId, name: 'P2', machineName: 'p2' });
      const first = await document('First', { slug: 'p2-first' });
      const moved = await document('Moved', { slug: 'p2-moved' });
      await ctx.menus.setItems(ctx.spaceId, menu.id, [{ localizationId: first.localizationId }]);

      await ctx.menus.setPlacements(ctx.spaceId, moved.localizationId, [
        { menuId: menu.id, parentId: null, index: 0 },
      ]);
      const added = await ctx.repos.menus.listItemTree(menu.id);
      expect(added.map((node) => node.item.localizationId)).toEqual([
        moved.localizationId,
        first.localizationId,
      ]);

      const parentId = added[1]?.item.id as string;
      const entryId = added[0]?.item.id;
      await ctx.menus.setPlacements(ctx.spaceId, moved.localizationId, [
        { menuId: menu.id, parentId, index: 0 },
      ]);
      const nested = await ctx.repos.menus.listItemTree(menu.id);
      expect(nested).toHaveLength(1);
      expect(nested[0]?.children[0]?.item.id).toBe(entryId);
    });

    it('takes the document out of the menus left out, sub-entries kept', async () => {
      const stays = await ctx.menus.create({ spaceId: ctx.spaceId, name: 'P3', machineName: 'p3' });
      const drops = await ctx.menus.create({ spaceId: ctx.spaceId, name: 'P4', machineName: 'p4' });
      const doc = await document('Both', { slug: 'p3-both' });
      await ctx.menus.setItems(ctx.spaceId, drops.id, [
        { localizationId: doc.localizationId, children: [{ url: '/kept', label: 'Kept' }] },
      ]);

      await ctx.menus.setPlacements(ctx.spaceId, doc.localizationId, [
        { menuId: stays.id, parentId: null, index: 0 },
      ]);

      expect(
        (await ctx.repos.menus.listItemTree(stays.id)).map((node) => node.item.localizationId),
      ).toEqual([doc.localizationId]);
      const left = await ctx.repos.menus.listItemTree(drops.id);
      expect(left.map((node) => node.item.url)).toEqual(['/kept']);
    });

    it('leaves one entry per menu when the document was in it twice', async () => {
      const menu = await ctx.menus.create({ spaceId: ctx.spaceId, name: 'P5', machineName: 'p5' });
      const doc = await document('Twice', { slug: 'p5-twice' });
      await ctx.menus.setItems(ctx.spaceId, menu.id, [
        { localizationId: doc.localizationId },
        { url: '/other', label: 'Other', children: [{ localizationId: doc.localizationId }] },
      ]);

      await ctx.menus.setPlacements(ctx.spaceId, doc.localizationId, [
        { menuId: menu.id, parentId: null, index: 1 },
      ]);

      const tree = await ctx.repos.menus.listItemTree(menu.id);
      expect(tree.map((node) => node.item.url ?? node.item.localizationId)).toEqual([
        '/other',
        doc.localizationId,
      ]);
      expect(tree[0]?.children).toEqual([]);
    });

    it('refuses a menu of another space', async () => {
      const other = await ctx.repos.spaces.create({
        name: 'P6',
        machineName: 'p6',
        url: 'http://p6',
      });
      const menu = await ctx.menus.create({ spaceId: other.id, name: 'P6', machineName: 'p6' });
      const doc = await document('Stranger', { slug: 'p6-doc' });
      await expect(
        ctx.menus.setPlacements(ctx.spaceId, doc.localizationId, [
          { menuId: menu.id, parentId: null, index: 0 },
        ]),
      ).rejects.toMatchObject({ key: 'menu.notFound' });
    });
  });

  it('drops link entries without a document in the requested locale from the public view', async () => {
    const menu = await ctx.menus.create({ spaceId: ctx.spaceId, name: 'Pub', machineName: 'pub' });
    const only = await document('English only', { slug: 'english-only' });
    await ctx.content.publish(ctx.spaceId, only.id);
    await ctx.menus.setItems(ctx.spaceId, menu.id, [
      { localizationId: only.localizationId },
      { url: 'https://example.test', label: 'Site' },
    ]);
    const en = await ctx.menus.resolve(ctx.spaceId, 'pub', 'en');
    expect(en?.items.map((item) => item.label)).toEqual(['English only', 'Site']);
    const de = await ctx.menus.resolve(ctx.spaceId, 'pub', 'de');
    expect(de?.items.map((item) => item.label)).toEqual(['Site']);
  });

  it('carries which tab an entry opens in through to delivery', async () => {
    const menu = await ctx.menus.create({
      spaceId: ctx.spaceId,
      name: 'Tabs',
      machineName: 'tabs',
    });
    await ctx.menus.setItems(ctx.spaceId, menu.id, [
      { url: 'https://example.test', label: 'Elsewhere', target: '_blank' },
      { url: '/contact', label: 'Contact' },
    ]);

    const resolved = await ctx.menus.resolve(ctx.spaceId, 'tabs', 'en');
    expect(resolved?.items.map((item) => item.target)).toEqual(['_blank', '_self']);

    // Read back so a save does not reset it.
    const detail = await ctx.menus.get(ctx.spaceId, menu.id, 'en');
    expect(detail.items.map((item) => item.target)).toEqual(['_blank', '_self']);
  });
});
