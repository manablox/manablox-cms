import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/client.js';
import { createRepositories } from '../src/repositories/index.js';
import {
  createRepositoryContext,
  makeNode,
  type RepositoryTestContext,
} from './helpers/repository.js';

let ctx: RepositoryTestContext;

beforeAll(async () => {
  ctx = await createRepositoryContext('concurrency');
});
afterAll(async () => {
  await ctx?.close();
});

describe('concurrent writers', () => {
  it('commits overlapping transactions and plain writes without losing any', async () => {
    const root = await makeNode(ctx, { title: 'Busy', slug: 'busy' });
    await ctx.repos.content.publish(root.id);
    const nodes = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        makeNode(ctx, { title: `n${i}`, slug: `busy-${i}`, parentId: root.id }),
      ),
    );
    await Promise.all([
      ...nodes.map((node) => ctx.repos.content.publish(node.id)),
      ...nodes.map((node) => ctx.repos.content.patchFields([node.id], { body: 'x' })),
      ...nodes.map((node, i) =>
        ctx.repos.audit.append({
          action: 'content.publish',
          targetKind: 'content',
          targetId: node.id,
          targetLabel: `n${i}`,
        }),
      ),
    ]);

    const children = await ctx.repos.content.pageTreeChildren(ctx.spaceId, 'en', root.id, {
      published: true,
      limit: 100,
    });
    expect(children.total).toBe(40);
    expect(await ctx.repos.audit.verify()).toMatchObject({ ok: true });
  });

  it('shares the database with another process writing at the same time', async () => {
    // A second handle has its own connections and write queue, as another process would.
    const other = await createDatabase({ url: ctx.url, max: 4 });
    const otherRepos = createRepositories(other, ctx.registry);
    try {
      const write = (repos: typeof ctx.repos, label: string) =>
        Array.from({ length: 15 }, async (_, i) => {
          const node = await repos.content.create({
            spaceId: ctx.spaceId,
            typeId: ctx.types.page.id,
            locale: 'en',
            title: `${label}${i}`,
            slug: `${label}-${i}`,
            fields: {},
            hasSlug: true,
          });
          await repos.content.publish(node.id);
          await repos.audit.append({ action: 'content.publish', targetKind: 'content' });
          return node.id;
        });
      const ids = await Promise.all([...write(ctx.repos, 'one'), ...write(otherRepos, 'two')]);

      // Each side reads what the other wrote.
      const mine = await ctx.repos.content.listByIds(ids, true);
      const theirs = await otherRepos.content.listByIds(ids, true);
      expect(mine).toHaveLength(30);
      expect(theirs).toHaveLength(30);
      expect(await ctx.repos.audit.verify()).toMatchObject({ ok: true });
    } finally {
      await other.close();
    }
  });
});
