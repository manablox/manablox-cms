import { type SQL, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createRepositoryContext,
  makeNode,
  type RepositoryTestContext,
} from './helpers/repository.js';

let ctx: RepositoryTestContext;

beforeAll(async () => {
  ctx = await createRepositoryContext('query');
  await makeNode(ctx, {
    title: 'Alpha',
    slug: 'alpha',
    fields: { body: 'hello world', weight: 5 },
  });
  await makeNode(ctx, {
    title: 'Beta',
    slug: 'beta',
    fields: { body: 'goodbye world', weight: 10 },
  });
  await makeNode(ctx, {
    title: 'Gamma',
    slug: 'gamma',
    fields: { body: 'hello again', weight: 15 },
  });
});
afterAll(async () => {
  await ctx?.close();
});

const page = (extra: Record<string, unknown> = {}) => ({
  spaceId: ctx.spaceId,
  typeIds: [ctx.types.page.id],
  ...extra,
});

describe('field filters', () => {
  it('filters by equality through jsonb containment', async () => {
    const result = await ctx.repos.content.page(
      page({ fields: [{ name: 'body', op: 'eq' as const, value: 'hello world' }] }),
      { limit: 10, offset: 0 },
    );
    expect(result.items.map((i) => i.slug)).toEqual(['alpha']);
    expect(result.total).toBe(1);
  });

  it('filters by substring', async () => {
    const result = await ctx.repos.content.page(
      page({ fields: [{ name: 'body', op: 'contains' as const, value: 'hello' }] }),
      { limit: 10, offset: 0 },
    );
    expect(result.items.map((i) => i.slug).sort()).toEqual(['alpha', 'gamma']);
  });

  it('filters numerically', async () => {
    const result = await ctx.repos.content.page(
      page({ fields: [{ name: 'weight', op: 'gt' as const, value: 7 }] }),
      { limit: 10, offset: 0 },
    );
    expect(result.items.map((i) => i.slug).sort()).toEqual(['beta', 'gamma']);
  });

  it('rejects an operator the field type does not declare', async () => {
    await expect(
      ctx.repos.content.page(
        page({ fields: [{ name: 'weight', op: 'contains' as const, value: 'x' }] }),
        { limit: 10, offset: 0 },
      ),
    ).rejects.toThrow(/operator.unsupported/);
  });

  it('rejects a field that does not exist on the content type', async () => {
    await expect(
      ctx.repos.content.page(page({ fields: [{ name: 'nope', op: 'eq' as const, value: 1 }] }), {
        limit: 10,
        offset: 0,
      }),
    ).rejects.toThrow(/field.unknown/);
  });

  it('escapes LIKE metacharacters instead of letting them act as wildcards', async () => {
    await makeNode(ctx, { title: 'Pct', slug: 'pct', fields: { body: '100% sure', weight: 1 } });
    const result = await ctx.repos.content.page(
      page({ fields: [{ name: 'body', op: 'contains' as const, value: '100%' }] }),
      { limit: 10, offset: 0 },
    );
    expect(result.items.map((i) => i.slug)).toEqual(['pct']);
  });

  it('returns a last page and its total in one round trip, a full one with a count', async () => {
    ctx.queries.length = 0;
    const all = await ctx.repos.content.page(page(), { limit: 100, offset: 0 });
    expect(all.total).toBe(all.items.length);
    expect(ctx.queries).toHaveLength(1);

    ctx.queries.length = 0;
    const result = await ctx.repos.content.page(page(), { limit: 2, offset: 0 });
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(all.total);
    expect(ctx.queries).toHaveLength(2);
  });
});

/** The query plan of `query`, one line per step. */
async function plan(query: SQL): Promise<string> {
  const { handle } = ctx;
  if (handle.kind === 'sqlite') {
    const rows = await handle.dialect.rows<{ detail: string }>(
      handle.db,
      sql`explain query plan ${query}`,
    );
    return rows.map((row) => row.detail).join('\n');
  }
  await handle.sql.unsafe('analyze contents');
  const rows = await handle.dialect.rows<Record<string, string>>(
    handle.db,
    sql`explain (format text) ${query}`,
  );
  return rows.map((row) => Object.values(row)[0]).join('\n');
}

describe('index coverage', () => {
  /** Every lookup key - `contentId`, `parent`, `permalink`, `space`, `locale` - is indexed. */
  it('uses the path index for subtree queries', async () => {
    const root = await makeNode(ctx, { title: 'IdxRoot', slug: 'idx-root' });
    for (let i = 0; i < 200; i++) {
      await makeNode(ctx, { title: `n${i}`, slug: `idx-${i}`, parentId: root.id });
    }
    const { contents } = ctx.handle.tables;
    const { dialect } = ctx.handle;
    const rootPath = sql`(select path from contents where id = ${dialect.param(root.id, 'uuid')})`;
    const text = await plan(
      sql`select * from ${contents} where ${dialect.pathWithin(contents.path, rootPath)}`,
    );

    expect(text).toMatch(
      ctx.handle.kind === 'sqlite' ? /contents_path_idx/ : /contents_path_gist_idx/,
    );
  });

  it('uses the permalink unique index for delivery lookups', async () => {
    const { dialect } = ctx.handle;
    const text = await plan(sql`
      select * from contents
      where space_id = ${dialect.param(ctx.spaceId, 'uuid')} and locale = 'en' and permalink = 'alpha'
        and environment_id = (select id from space_environments where space_id = ${dialect.param(ctx.spaceId, 'uuid')} and kind = 'production')
    `);

    expect(text).toMatch(/contents_permalink_key/);
  });
});

describe('full-text search', () => {
  it('matches words in the title and field text', async () => {
    const result = await ctx.repos.content.page(page({ search: 'goodbye' }), {
      limit: 10,
      offset: 0,
    });
    expect(result.items.map((i) => i.slug)).toEqual(['beta']);
  });

  it('reads websearch syntax the same on every database', async () => {
    const slugs = async (search: string) =>
      (await ctx.repos.content.page(page({ search }), { limit: 10, offset: 0 })).items
        .map((i) => i.slug)
        .sort();

    // Whole words only, any case.
    expect(await slugs('hell')).toEqual([]);
    expect(await slugs('HELLO')).toEqual(['alpha', 'gamma']);
    expect(await slugs('hello world')).toEqual(['alpha']);
    expect(await slugs('hello -again')).toEqual(['alpha']);
    expect(await slugs('goodbye or again')).toEqual(['beta', 'gamma']);
    expect(await slugs('"world hello"')).toEqual([]);
    expect(await slugs('"hello world"')).toEqual(['alpha']);
    expect(await slugs('!!')).toEqual([]);
  });

  it('follows edits, publishing and deletes', async () => {
    const node = await makeNode(ctx, { title: 'Delta', slug: 'delta', fields: { body: 'zebra' } });
    await ctx.repos.content.publish(node.id);
    await ctx.repos.content.patchFields([node.id], { body: 'okapi' });
    await ctx.repos.content.update(node.id, {
      spaceId: ctx.spaceId,
      typeId: ctx.types.page.id,
      locale: 'en',
      title: 'Delta',
      slug: 'delta',
      fields: { body: 'okapi' },
      searchText: 'okapi',
      hasSlug: true,
    });
    const found = async (search: string, published = false) =>
      (await ctx.repos.content.page(page({ search }), { limit: 10, offset: 0 }, [], published))
        .items.length;

    expect(await found('okapi')).toBe(1);
    expect(await found('zebra')).toBe(0);
    expect(await found('zebra', true)).toBe(1);
    await ctx.repos.content.unpublish(node.id);
    expect(await found('zebra', true)).toBe(0);
    await ctx.repos.content.deleteReturning(node.id);
    expect(await found('okapi')).toBe(0);
  });
});

describe('paginate', () => {
  it('answers a last page without a count, a full one and one past the end with it', async () => {
    const { paginate } = await import('../src/pagination.js');
    const { users } = await import('../src/schema/index.js');
    for (const n of [1, 2, 3]) {
      await ctx.repos.users.create({
        name: `P${n}`,
        email: `p${n}@example.com`,
        role: 'editor',
        passwordHash: 'x',
      });
    }
    ctx.queries.length = 0;
    const first = await paginate(ctx.handle.db, users, {
      orderBy: users.createdAt,
      pagination: { limit: 2, offset: 0 },
    });
    expect(first.items).toHaveLength(2);
    expect(first.total).toBe(3);
    expect(ctx.queries).toHaveLength(2);

    ctx.queries.length = 0;
    const last = await paginate(ctx.handle.db, users, {
      orderBy: users.createdAt,
      pagination: { limit: 2, offset: 2 },
    });
    expect(last.items).toHaveLength(1);
    expect(last.total).toBe(3);
    expect(ctx.queries).toHaveLength(1);

    const past = await paginate(ctx.handle.db, users, {
      orderBy: users.createdAt,
      pagination: { limit: 2, offset: 10 },
    });
    expect(past.items).toEqual([]);
    expect(past.total).toBe(3);
  });

  it('pages rows with equal sort keys in id order, none repeated or skipped', async () => {
    const { contents } = await import('../src/schema/index.js');
    const rows = [];
    for (const n of [1, 2, 3, 4, 5]) {
      rows.push(await makeNode(ctx, { title: `Tie ${n}`, slug: `tie-${n}`, type: 'folder' }));
    }
    // What one import statement leaves behind: the same position and timestamp.
    const at = new Date('2026-01-01T00:00:00Z');
    for (const row of rows) {
      await ctx.handle.db
        .update(contents)
        .set({ position: 0, createdAt: at })
        .where(sql`${contents.id} = ${row.id}`);
    }
    const filter = { spaceId: ctx.spaceId, typeIds: [ctx.types.folder.id] };
    const seen: string[] = [];
    for (let offset = 0; offset < rows.length; offset += 2) {
      const next = await ctx.repos.content.page(filter, { limit: 2, offset });
      seen.push(...next.items.map((item) => item.id));
    }
    expect(seen).toEqual(rows.map((row) => row.id).sort());
  });
});

describe('capped counts', () => {
  it('stops counting at the cap and says so', async () => {
    const { paginate } = await import('../src/pagination.js');
    const { contents } = await import('../src/schema/index.js');
    const where = sql`${contents.spaceId} = ${ctx.spaceId}`;
    const exact = await paginate(ctx.handle.db, contents, {
      where,
      orderBy: contents.createdAt,
      pagination: { limit: 1, offset: 0 },
    });
    expect(exact.total).toBeGreaterThan(3);
    expect(exact.capped).toBeUndefined();

    const capped = await paginate(ctx.handle.db, contents, {
      where,
      orderBy: contents.createdAt,
      pagination: { limit: 1, offset: 0 },
      countCap: 2,
    });
    expect(capped).toMatchObject({ total: 2, capped: true });
    expect(capped.items).toHaveLength(1);

    const roomy = await paginate(ctx.handle.db, contents, {
      where,
      orderBy: contents.createdAt,
      pagination: { limit: 1, offset: 0 },
      countCap: exact.total,
    });
    expect(roomy.total).toBe(exact.total);
    expect(roomy.capped).toBeUndefined();
  });
});

describe('keyset batches', () => {
  const walk = async (
    batch: number,
    sorts: Array<{ by: 'createdAt'; direction: 'asc' | 'desc' }> = [],
  ) => {
    const out: string[] = [];
    for await (const rows of ctx.repos.content.batches(
      { spaceId: ctx.spaceId },
      { sorts, batch },
    )) {
      out.push(...rows.map((row) => row.id));
    }
    return out;
  };
  const paged = async (sorts: Array<{ by: 'createdAt'; direction: 'asc' | 'desc' }> = []) =>
    (
      await ctx.repos.content.page({ spaceId: ctx.spaceId }, { limit: 1000, offset: 0 }, sorts)
    ).items.map((row) => row.id);

  it('walks every row once, in the order of a page, whatever the batch size', async () => {
    const expected = await paged();
    expect(expected.length).toBeGreaterThan(5);
    for (const batch of [1, 2, 3, 1000]) expect(await walk(batch)).toEqual(expected);
    const newest = await paged([{ by: 'createdAt', direction: 'desc' }]);
    expect(await walk(2, [{ by: 'createdAt', direction: 'desc' }])).toEqual(newest);
  });

  it('reads no OFFSET and no count', async () => {
    ctx.queries.length = 0;
    await walk(2);
    expect(ctx.queries.some((query) => /offset|count\(/i.test(query))).toBe(false);
  });

  it('goes on after a row deleted under its cursor, repeating nothing', async () => {
    const { contents } = await import('../src/schema/index.js');
    const extra = [];
    for (const n of [1, 2, 3, 4]) {
      extra.push(await makeNode(ctx, { title: `Walk ${n}`, slug: `walk-${n}`, type: 'folder' }));
    }
    const expected = await paged();
    const out: string[] = [];
    let deleted: string | null = null;
    for await (const rows of ctx.repos.content.batches({ spaceId: ctx.spaceId }, { batch: 2 })) {
      out.push(...rows.map((row) => row.id));
      if (!deleted && out.length >= 4) {
        // The cursor of the next batch goes away.
        deleted = rows.at(-1)?.id ?? null;
        await ctx.handle.db.delete(contents).where(sql`${contents.id} = ${deleted}`);
      }
    }
    expect(new Set(out).size).toBe(out.length);
    expect(out).toEqual(expected);
  });
});
