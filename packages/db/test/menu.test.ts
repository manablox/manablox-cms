import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isUniqueViolation } from '../src/errors.js';
import {
  createRepositoryContext,
  makeNode,
  type RepositoryTestContext,
} from './helpers/repository.js';

let ctx: RepositoryTestContext;

beforeAll(async () => {
  ctx = await createRepositoryContext('menu');
});
afterAll(async () => {
  await ctx?.close();
});

const menu = (machineName: string) =>
  ctx.repos.menus.create({ spaceId: ctx.spaceId, name: machineName, machineName });

describe('menus', () => {
  it('stores a nested tree and reads it back in order', async () => {
    const main = await menu('main');
    const home = await makeNode(ctx, { title: 'Home', slug: 'home' });
    const about = await makeNode(ctx, { title: 'About', slug: 'about' });
    const team = await makeNode(ctx, { title: 'Team', slug: 'team', parentId: about.id });

    await ctx.repos.menus.setItems(main.id, [
      { localizationId: home.localizationId },
      {
        localizationId: about.localizationId,
        label: 'Who we are',
        children: [
          { localizationId: team.localizationId },
          { url: 'https://jobs.example', label: 'Jobs' },
        ],
      },
    ]);

    const tree = await ctx.repos.menus.listItemTree(main.id);
    expect(tree.map((node) => node.item.localizationId)).toEqual([
      home.localizationId,
      about.localizationId,
    ]);
    expect(tree[1]?.item.label).toBe('Who we are');
    expect(tree[1]?.children.map((node) => node.item.url)).toEqual([null, 'https://jobs.example']);
  });

  it('stores which tab an entry opens in, defaulting to this one', async () => {
    const main = await menu('targets');
    await ctx.repos.menus.setItems(main.id, [
      { url: 'https://example.test', label: 'Elsewhere', target: '_blank' },
      { url: '/contact', label: 'Contact' },
    ]);

    const tree = await ctx.repos.menus.listItemTree(main.id);
    expect(tree.map((node) => node.item.target)).toEqual(['_blank', '_self']);

    const resolved = await ctx.repos.menus.resolve(
      (await ctx.repos.menus.findById(main.id)) as NonNullable<
        Awaited<ReturnType<typeof ctx.repos.menus.findById>>
      >,
      'en',
    );
    expect(resolved.map((item) => item.target)).toEqual(['_blank', '_self']);
  });

  it("keeps an entry's id across saves when it is handed back", async () => {
    const footer = await menu('footer');
    const legal = await makeNode(ctx, { title: 'Legal', slug: 'legal' });
    const [first] = await ctx.repos.menus.setItems(footer.id, [
      { localizationId: legal.localizationId },
    ]);
    const [second] = await ctx.repos.menus.setItems(footer.id, [
      { id: first?.item.id, localizationId: legal.localizationId, label: 'Imprint' },
    ]);
    expect(second?.item.id).toBe(first?.item.id);
    expect(second?.item.label).toBe('Imprint');
  });

  it('resolves each entry to the document of the requested locale, published or draft', async () => {
    const nav = await menu('nav');
    const en = await makeNode(ctx, { title: 'Contact', slug: 'contact' });
    const de = await ctx.repos.content.create({
      spaceId: ctx.spaceId,
      typeId: ctx.types.page.id,
      locale: 'de',
      localizationId: en.localizationId,
      parentId: null,
      title: 'Kontakt',
      slug: 'kontakt',
      fields: {},
      hasSlug: true,
    });
    const onlyEnglish = await makeNode(ctx, { title: 'Blog', slug: 'blog' });
    await ctx.repos.menus.setItems(nav.id, [
      { localizationId: en.localizationId },
      { localizationId: onlyEnglish.localizationId },
      { url: '/rss', label: 'Feed' },
    ]);

    const german = await ctx.repos.menus.resolve(nav, 'de');
    expect(german.map((item) => item.content?.title ?? null)).toEqual(['Kontakt', null, null]);
    expect(german[1]?.localizationId).toBe(onlyEnglish.localizationId);

    // Nothing is published yet.
    const live = await ctx.repos.menus.resolve(nav, 'de', true);
    expect(live.map((item) => item.content)).toEqual([null, null, null]);

    await ctx.repos.content.publish(de.id);
    const afterPublish = await ctx.repos.menus.resolve(nav, 'de', true);
    expect(afterPublish[0]?.content?.title).toBe('Kontakt');
    expect(afterPublish[0]?.content?.status).toBe('published');
  });

  it('removes a document from every menu, sub-entries included', async () => {
    const a = await menu('a');
    const b = await menu('b');
    const parent = await makeNode(ctx, { title: 'Parent', slug: 'parent' });
    const child = await makeNode(ctx, { title: 'Child', slug: 'child', parentId: parent.id });
    await ctx.repos.menus.setItems(a.id, [
      {
        localizationId: parent.localizationId,
        children: [{ localizationId: child.localizationId }],
      },
    ]);
    await ctx.repos.menus.setItems(b.id, [{ localizationId: parent.localizationId }]);

    const referencing = await ctx.repos.menus.listByLocalizations(
      ctx.spaceId,
      parent.localizationId,
    );
    expect(referencing.map((row) => row.machineName).sort()).toEqual(['a', 'b']);

    expect(await ctx.repos.menus.deleteItemsByLocalizations(parent.localizationId)).toBe(true);
    expect(await ctx.repos.menus.listItems(a.id)).toEqual([]);
    expect(await ctx.repos.menus.listItems(b.id)).toEqual([]);
  });

  it('deletes a menu with its entries and refuses a duplicate technical name', async () => {
    const gone = await menu('gone');
    const page = await makeNode(ctx, { title: 'Gone', slug: 'gone' });
    await ctx.repos.menus.setItems(gone.id, [{ localizationId: page.localizationId }]);
    await ctx.repos.menus.delete(gone.id);
    expect(await ctx.repos.menus.findById(gone.id)).toBeNull();
    expect(await ctx.repos.menus.listItems(gone.id)).toEqual([]);

    await expect(menu('main')).rejects.toSatisfy((error: unknown) =>
      isUniqueViolation(error, 'machine_name'),
    );
  });
});
