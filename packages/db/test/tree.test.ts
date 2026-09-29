import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createRepositoryContext,
  makeNode,
  type RepositoryTestContext,
} from './helpers/repository.js';

let ctx: RepositoryTestContext;

beforeAll(async () => {
  ctx = await createRepositoryContext('tree');
});
afterAll(async () => {
  await ctx?.close();
});

describe('permalinks', () => {
  it('derives a permalink from the ancestor chain', async () => {
    const root = await makeNode(ctx, { title: 'Root', slug: 'root' });
    const child = await makeNode(ctx, { title: 'Child', slug: 'child', parentId: root.id });
    const grandchild = await makeNode(ctx, { title: 'GC', slug: 'gc', parentId: child.id });

    expect(root.permalink).toBe('root');
    expect(child.permalink).toBe('root/child');
    expect(grandchild.permalink).toBe('root/child/gc');
  });

  it('is transparent for a content type that has no slug', async () => {
    const root = await makeNode(ctx, { title: 'Docs', slug: 'docs' });
    const folder = await makeNode(ctx, {
      title: 'Hidden',
      slug: 'hidden',
      parentId: root.id,
      type: 'folder',
    });
    const leaf = await makeNode(ctx, { title: 'Leaf', slug: 'leaf', parentId: folder.id });

    // A slug-less node has no permalink and is skipped in descendants' paths.
    expect(folder.permalink).toBeNull();
    expect(folder.permalinkPath).toBe('docs');
    expect(leaf.permalink).toBe('docs/leaf');
  });

  it('keeps descendants correct when a slug-less level sits mid-chain and a slug changes', async () => {
    const root = await makeNode(ctx, { title: 'Site', slug: 'site' });
    const folder = await makeNode(ctx, {
      title: 'Group',
      slug: 'group',
      parentId: root.id,
      type: 'folder',
    });
    const leaf = await makeNode(ctx, { title: 'Deep', slug: 'deep', parentId: folder.id });

    expect(leaf.permalink).toBe('site/deep');

    await ctx.repos.content.update(root.id, {
      spaceId: ctx.spaceId,
      typeId: ctx.types.page.id,
      locale: 'en',
      parentId: null,
      title: 'Site',
      slug: 'website',
      fields: {},
      hasSlug: true,
    });

    const [nf, nl] = await Promise.all([
      ctx.repos.content.findById(folder.id),
      ctx.repos.content.findById(leaf.id),
    ]);
    expect(nf?.permalink).toBeNull();
    expect(nf?.permalinkPath).toBe('website');
    expect(nl?.permalink).toBe('website/deep');
  });

  /** A deep node's permalink derives from its own parent, not its grandparent. */
  it('rewrites the whole subtree when a slug changes - grandchildren included', async () => {
    const a = await makeNode(ctx, { title: 'A', slug: 'a' });
    const b = await makeNode(ctx, { title: 'B', slug: 'b', parentId: a.id });
    const c = await makeNode(ctx, { title: 'C', slug: 'c', parentId: b.id });
    const d = await makeNode(ctx, { title: 'D', slug: 'd', parentId: c.id });

    expect(d.permalink).toBe('a/b/c/d');

    await ctx.repos.content.update(a.id, {
      spaceId: ctx.spaceId,
      typeId: ctx.types.page.id,
      locale: 'en',
      parentId: null,
      title: 'A',
      slug: 'alpha',
      fields: {},
      hasSlug: true,
    });

    const [nb, nc, nd] = await Promise.all([
      ctx.repos.content.findById(b.id),
      ctx.repos.content.findById(c.id),
      ctx.repos.content.findById(d.id),
    ]);

    expect(nb?.permalink).toBe('alpha/b');
    expect(nc?.permalink).toBe('alpha/b/c');
    expect(nd?.permalink).toBe('alpha/b/c/d');
  });

  it('rebases paths and permalinks when a subtree is reparented', async () => {
    const home = await makeNode(ctx, { title: 'Home', slug: 'home' });
    const shop = await makeNode(ctx, { title: 'Shop', slug: 'shop' });
    const cat = await makeNode(ctx, { title: 'Cat', slug: 'cat', parentId: home.id });
    const item = await makeNode(ctx, { title: 'Item', slug: 'item', parentId: cat.id });

    expect(item.permalink).toBe('home/cat/item');

    await ctx.repos.content.update(cat.id, {
      spaceId: ctx.spaceId,
      typeId: ctx.types.page.id,
      locale: 'en',
      parentId: shop.id,
      title: 'Cat',
      slug: 'cat',
      fields: {},
      hasSlug: true,
    });

    const movedItem = await ctx.repos.content.findById(item.id);
    expect(movedItem?.permalink).toBe('shop/cat/item');
    // The ltree path is rebased too.
    const movedCat = await ctx.repos.content.findById(cat.id);
    expect(movedItem?.path.startsWith(`${movedCat?.path}.`)).toBe(true);
  });

  it('refuses to make a node its own descendant', async () => {
    const a = await makeNode(ctx, { title: 'X', slug: 'x' });
    const b = await makeNode(ctx, { title: 'Y', slug: 'y', parentId: a.id });

    await expect(
      ctx.repos.content.update(a.id, {
        spaceId: ctx.spaceId,
        typeId: ctx.types.page.id,
        locale: 'en',
        parentId: b.id,
        title: 'X',
        slug: 'x',
        fields: {},
        hasSlug: true,
      }),
    ).rejects.toThrow(/cycle/);
  });

  it('rejects duplicate slugs among root-level siblings (NULLS NOT DISTINCT)', async () => {
    await makeNode(ctx, { title: 'Dup', slug: 'duplicate-root' });
    await expect(makeNode(ctx, { title: 'Dup2', slug: 'duplicate-root' })).rejects.toThrow();
  });
});

describe('tree loading', () => {
  it('returns a whole tree in a single query', async () => {
    const root = await makeNode(ctx, { title: 'T', slug: 'tree-root' });
    const l1 = await makeNode(ctx, { title: 'L1', slug: 'l1', parentId: root.id });
    await makeNode(ctx, { title: 'L2', slug: 'l2', parentId: l1.id });
    await makeNode(ctx, { title: 'L1b', slug: 'l1b', parentId: root.id });

    ctx.queries.length = 0;
    const nodes = await ctx.repos.content.listTree(ctx.spaceId, 'en', root.id);

    expect(ctx.queries).toHaveLength(1);
    expect(nodes).toHaveLength(2);
    const first = nodes.find((n) => n.content.slug === 'l1');
    expect(first?.children.map((c) => c.content.slug)).toEqual(['l2']);
  });

  it('loads one level at a time, in pages', async () => {
    const root = await makeNode(ctx, { title: 'Paged', slug: 'paged-root' });
    for (let index = 0; index < 5; index++) {
      await makeNode(ctx, {
        title: `Child ${index}`,
        slug: `paged-child-${index}`,
        parentId: root.id,
      });
    }

    const first = await ctx.repos.content.pageTreeChildren(ctx.spaceId, 'en', root.id, {
      limit: 2,
    });
    expect(first.total).toBe(5);
    expect(first.items.map((node) => node.content.slug)).toEqual([
      'paged-child-0',
      'paged-child-1',
    ]);

    const next = await ctx.repos.content.pageTreeChildren(ctx.spaceId, 'en', root.id, {
      limit: 2,
      offset: 2,
    });
    expect(next.items.map((node) => node.content.slug)).toEqual(['paged-child-2', 'paged-child-3']);

    // Past the end, the total is still reported.
    const past = await ctx.repos.content.pageTreeChildren(ctx.spaceId, 'en', root.id, {
      limit: 2,
      offset: 10,
    });
    expect(past.items).toEqual([]);
    expect(past.total).toBe(5);
  });

  it('pages siblings with equal position and title in id order', async () => {
    const root = await makeNode(ctx, { title: 'Ties', slug: 'ties-root' });
    const kids = [];
    for (let index = 0; index < 5; index++) {
      kids.push(await makeNode(ctx, { title: 'Same', slug: `tie-${index}`, parentId: root.id }));
    }
    const { contents } = await import('../src/schema/index.js');
    await ctx.handle.db
      .update(contents)
      .set({ position: 0 })
      .where(sql`${contents.parentId} = ${root.id}`);
    const seen: string[] = [];
    for (let offset = 0; offset < kids.length; offset += 2) {
      const next = await ctx.repos.content.pageTreeChildren(ctx.spaceId, 'en', root.id, {
        limit: 2,
        offset,
      });
      seen.push(...next.items.map((node) => node.content.id));
    }
    expect(seen).toEqual(kids.map((kid) => kid.id).sort());
  });

  it('counts the children of each row, so a level knows which rows expand', async () => {
    const root = await makeNode(ctx, { title: 'Counted', slug: 'counted-root' });
    const withKids = await makeNode(ctx, {
      title: 'Branch',
      slug: 'counted-branch',
      parentId: root.id,
    });
    await makeNode(ctx, { title: 'Leaf', slug: 'counted-leaf', parentId: root.id });
    await makeNode(ctx, { title: 'K1', slug: 'counted-k1', parentId: withKids.id });
    await makeNode(ctx, { title: 'K2', slug: 'counted-k2', parentId: withKids.id });
    await makeNode(ctx, { title: 'K3', slug: 'counted-k3', parentId: withKids.id });

    const level = await ctx.repos.content.pageTreeChildren(ctx.spaceId, 'en', root.id);
    const byId = new Map(level.items.map((node) => [node.content.id, node.childCount]));
    expect(byId.get(withKids.id)).toBe(3);
    expect(level.items.find((node) => node.content.slug === 'counted-leaf')?.childCount).toBe(0);
  });

  it('finds children and counts through nested hidden rows like a walk of the tree', async () => {
    const top = await makeNode(ctx, { title: 'Nested', slug: 'nested-root' });
    const node = (title: string, parentId: string, type?: 'folder') =>
      makeNode(ctx, { title, slug: title.toLowerCase(), parentId, ...(type ? { type } : {}) });
    const f1 = await node('NF1', top.id, 'folder');
    await node('NP1', f1.id);
    const f2 = await node('NF2', top.id, 'folder');
    const f3 = await node('NF3', f2.id, 'folder');
    await node('NP2', f3.id);
    const p3 = await node('NP3', top.id);
    const f4 = await node('NF4', p3.id, 'folder');
    await node('NP4', f4.id);
    await node('NP5', f4.id);
    await node('NP6', p3.id);

    const { contents } = await import('../src/schema/index.js');
    const all = await ctx.handle.db
      .select({ id: contents.id, parentId: contents.parentId, typeId: contents.typeId })
      .from(contents)
      .where(sql`${contents.spaceId} = ${ctx.spaceId} and ${contents.locale} = 'en'`);
    for (const hiddenTypeIds of [[ctx.types.folder.id], []]) {
      const hidden = (row: { typeId: string }) => hiddenTypeIds.includes(row.typeId);
      const reference = (parentId: string | null): string[] =>
        all
          .filter((row) => row.parentId === parentId)
          .flatMap((row) => (hidden(row) ? reference(row.id) : [row.id]));
      const parents = [null, ...all.filter((row) => !hidden(row)).map((row) => row.id)];
      for (const parentId of parents) {
        const page = await ctx.repos.content.pageTreeChildren(ctx.spaceId, 'en', parentId, {
          limit: 1000,
          hiddenTypeIds,
        });
        const expected = reference(parentId);
        expect(page.items.map((item) => item.content.id).sort()).toEqual([...expected].sort());
        expect(page.total).toBe(expected.length);
        for (const item of page.items) {
          expect(item.childCount).toBe(reference(item.content.id).length);
        }
      }
    }
  });

  it('skips a hidden type and lifts its children into its place', async () => {
    const root = await makeNode(ctx, { title: 'Hidden', slug: 'hidden-root' });
    const hidden = await makeNode(ctx, {
      title: 'Not a node',
      slug: 'hidden-mid',
      parentId: root.id,
      type: 'folder',
    });
    await makeNode(ctx, { title: 'Lifted', slug: 'hidden-lifted', parentId: hidden.id });
    await makeNode(ctx, { title: 'Plain', slug: 'hidden-plain', parentId: root.id });

    const hiddenTypeIds = [ctx.types.folder.id];
    const level = await ctx.repos.content.pageTreeChildren(ctx.spaceId, 'en', root.id, {
      hiddenTypeIds,
    });

    expect(level.total).toBe(2);
    expect(level.items.map((node) => node.content.slug).sort()).toEqual([
      'hidden-lifted',
      'hidden-plain',
    ]);
    // The root's count matches its level.
    const roots = await ctx.repos.content.pageTreeChildren(ctx.spaceId, 'en', null, {
      hiddenTypeIds,
    });
    expect(roots.items.find((node) => node.content.id === root.id)?.childCount).toBe(2);
  });

  it('reads ancestors straight off the materialised path', async () => {
    const a = await makeNode(ctx, { title: 'A', slug: 'anc-a' });
    const b = await makeNode(ctx, { title: 'B', slug: 'anc-b', parentId: a.id });
    const c = await makeNode(ctx, { title: 'C', slug: 'anc-c', parentId: b.id });

    const ancestors = await ctx.repos.content.listAncestors(c.id);
    expect(ancestors.map((row) => row.slug)).toEqual(['anc-a', 'anc-b']);
  });

  it('deletes a node together with its subtree', async () => {
    const root = await makeNode(ctx, { title: 'D', slug: 'del-root' });
    const child = await makeNode(ctx, { title: 'D1', slug: 'del-1', parentId: root.id });
    await makeNode(ctx, { title: 'D2', slug: 'del-2', parentId: child.id });

    const deleted = await ctx.repos.content.deleteReturning(root.id);
    expect(deleted.map((row) => row.id)[0]).toBe(root.id);
    expect(deleted).toHaveLength(3);
    expect(await ctx.repos.content.findById(child.id)).toBeNull();
  });

  it('lifts the children into its place when a delete reparents them', async () => {
    const root = await makeNode(ctx, { title: 'R', slug: 'lift-root' });
    const doomed = await makeNode(ctx, { title: 'X', slug: 'lift-x', parentId: root.id });
    const child = await makeNode(ctx, { title: 'C', slug: 'lift-c', parentId: doomed.id });
    const grandchild = await makeNode(ctx, { title: 'G', slug: 'lift-g', parentId: child.id });

    const deleted = await ctx.repos.content.deleteReturning(doomed.id, 'reparent');
    expect(deleted.map((row) => row.id)).toEqual([doomed.id]);

    const lifted = await ctx.repos.content.findById(child.id);
    expect(lifted?.parentId).toBe(root.id);
    // The subtree's permalinks follow the new level.
    expect(lifted?.permalink).toBe('lift-root/lift-c');
    expect((await ctx.repos.content.findById(grandchild.id))?.permalink).toBe(
      'lift-root/lift-c/lift-g',
    );
  });
});
