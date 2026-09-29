import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createRepositoryContext,
  makeNode,
  type RepositoryTestContext,
} from './helpers/repository.js';

let ctx: RepositoryTestContext;

beforeAll(async () => {
  ctx = await createRepositoryContext('publish');
});
afterAll(async () => {
  await ctx?.close();
});

const update = (id: string, over: Record<string, unknown>) =>
  ctx.repos.content.update(id, {
    spaceId: ctx.spaceId,
    typeId: ctx.types.page.id,
    locale: 'en',
    title: 'T',
    slug: 's',
    fields: {},
    hasSlug: true,
    ...over,
  } as never);

describe('publishing', () => {
  it('projects a draft into the delivery table', async () => {
    const node = await makeNode(ctx, { title: 'Post', slug: 'post', fields: { body: 'v1' } });
    expect(await ctx.repos.content.findById(node.id, true)).toBeNull();

    await ctx.repos.content.publish(node.id);

    const published = await ctx.repos.content.findById(node.id, true);
    expect(published?.permalink).toBe('post');
    expect(published?.status).toBe('published');
    expect((published?.fields as Record<string, unknown>).body).toBe('v1');
  });

  it('reads the projection without its search columns', async () => {
    const node = await makeNode(ctx, {
      title: 'Vector',
      slug: 'vector',
      fields: { body: 'words' },
    });
    await ctx.repos.content.publish(node.id);

    const reads = [
      await ctx.repos.content.findById(node.id, true),
      await ctx.repos.content.findByPermalink(ctx.spaceId, 'en', 'vector', true),
      ...(await ctx.repos.content.listByIds([node.id], true)),
      ...(await ctx.repos.content.listTree(ctx.spaceId, 'en', null, 32, true))
        .map((tree) => tree.content)
        .filter((row) => row.id === node.id),
      ...(
        await ctx.repos.content.page(
          { spaceId: ctx.spaceId, search: 'words' },
          { limit: 5, offset: 0 },
          [],
          true,
        )
      ).items,
    ];
    expect(reads).toHaveLength(5);
    for (const row of reads) {
      expect(row?.id).toBe(node.id);
      expect(row?.search).toBeNull();
      expect(row?.searchText).toBeNull();
    }
    const draft = await ctx.repos.content.findById(node.id);
    expect(draft?.searchText).toBe('words');
  });

  it('keeps the draft and the published projection independent', async () => {
    const node = await makeNode(ctx, {
      title: 'Draftable',
      slug: 'draftable',
      fields: { body: 'v1' },
    });
    await ctx.repos.content.publish(node.id);

    await update(node.id, { title: 'Draftable', slug: 'draftable', fields: { body: 'v2' } });

    const draft = await ctx.repos.content.findById(node.id);
    const published = await ctx.repos.content.findById(node.id, true);
    expect((draft?.fields as Record<string, unknown>).body).toBe('v2');
    expect((published?.fields as Record<string, unknown>).body).toBe('v1');
  });

  it('keeps published children when their parent is deleted with a reparent', async () => {
    const root = await makeNode(ctx, { title: 'PR', slug: 'pub-root' });
    const doomed = await makeNode(ctx, { title: 'PX', slug: 'pub-x', parentId: root.id });
    const child = await makeNode(ctx, { title: 'PC', slug: 'pub-c', parentId: doomed.id });
    await ctx.repos.content.publish(root.id);
    await ctx.repos.content.publish(doomed.id);
    await ctx.repos.content.publish(child.id);

    await ctx.repos.content.deleteReturning(doomed.id, 'reparent');

    expect(await ctx.repos.content.findById(doomed.id, true)).toBeNull();
    // The projection follows the draft up a level.
    expect((await ctx.repos.content.findById(child.id, true))?.permalink).toBe('pub-root/pub-c');
  });

  it('rewrites published descendants when the parent permalink changes', async () => {
    const root = await makeNode(ctx, { title: 'R', slug: 'r' });
    const child = await makeNode(ctx, { title: 'C', slug: 'c', parentId: root.id });
    await ctx.repos.content.publish(root.id);
    await ctx.repos.content.publish(child.id);

    await update(root.id, { title: 'R', slug: 'renamed', parentId: null });
    await ctx.repos.content.publish(root.id);

    const publishedChild = await ctx.repos.content.findById(child.id, true);
    expect(publishedChild?.permalink).toBe('renamed/c');
  });

  it('removes the subtree from the projection on unpublish', async () => {
    const root = await makeNode(ctx, { title: 'U', slug: 'u' });
    const child = await makeNode(ctx, { title: 'U1', slug: 'u1', parentId: root.id });
    const grandchild = await makeNode(ctx, { title: 'U2', slug: 'u2', parentId: child.id });
    const unpublishedChild = await makeNode(ctx, { title: 'U3', slug: 'u3', parentId: root.id });
    await ctx.repos.content.publish(root.id);
    await ctx.repos.content.publish(child.id);
    await ctx.repos.content.publish(grandchild.id);

    const rows = await ctx.repos.content.unpublish(root.id);

    expect(rows.map((row) => row.id)).toEqual([root.id, ...rows.slice(1).map((row) => row.id)]);
    expect(new Set(rows.map((row) => row.id))).toEqual(new Set([root.id, child.id, grandchild.id]));
    for (const node of [root, child, grandchild]) {
      expect(await ctx.repos.content.findById(node.id, true)).toBeNull();
      const draft = await ctx.repos.content.findById(node.id);
      expect(draft?.status).toBe('draft');
      expect(draft?.publishedAt).toBeNull();
    }
    // Never live, so untouched.
    expect(rows.some((row) => row.id === unpublishedChild.id)).toBe(false);
  });
});

describe('versions and optimistic locking', () => {
  it('snapshots every save', async () => {
    const node = await makeNode(ctx, { title: 'V', slug: 'v', fields: { body: 'one' } });
    await update(node.id, { title: 'V', slug: 'v', fields: { body: 'two' } });
    await update(node.id, { title: 'V', slug: 'v', fields: { body: 'three' } });

    const versions = await ctx.repos.content.pageVersions(node.id);
    expect(versions.total).toBe(3);
    expect(versions.items.map((v) => v.version)).toEqual([3, 2, 1]);

    const first = await ctx.repos.content.findVersionSnapshot(node.id, 1);
    expect((first?.fields as Record<string, unknown>).body).toBe('one');
  });

  /** Optimistic locking: a stale version must not silently win. */
  it('rejects a write built on a stale version', async () => {
    const node = await makeNode(ctx, { title: 'L', slug: 'lock' });
    await update(node.id, { title: 'L', slug: 'lock', expectedVersion: 1 });

    await expect(update(node.id, { title: 'L', slug: 'lock', expectedVersion: 1 })).rejects.toThrow(
      /version.conflict/,
    );
  });
});

describe('republishing', () => {
  it('rewrites descendants published beneath a parent that was not yet projected', async () => {
    const root = await makeNode(ctx, { title: 'Late', slug: 'late' });
    const child = await makeNode(ctx, { title: 'Early', slug: 'early', parentId: root.id });
    // An unpublished parent is transparent in the published path.
    await ctx.repos.content.publish(child.id);
    expect((await ctx.repos.content.findById(child.id, true))?.permalink).toBe('early');

    await update(root.id, { title: 'Late', slug: 'later', parentId: null });
    await ctx.repos.content.publish(root.id);

    expect((await ctx.repos.content.findById(child.id, true))?.permalink).toBe('later/early');
  });

  it('skips the subtree walk when a republish leaves the permalink path alone', async () => {
    const node = await makeNode(ctx, { title: 'Same', slug: 'same', fields: { body: 'v1' } });
    await ctx.repos.content.publish(node.id);
    await update(node.id, { title: 'Same', slug: 'same', fields: { body: 'v2' } });

    ctx.queries.length = 0;
    await ctx.repos.content.publish(node.id);

    expect(ctx.queries.some((query) => /with recursive/i.test(query))).toBe(false);
    expect((await ctx.repos.content.findById(node.id, true))?.fields).toEqual({ body: 'v2' });
  });
});
