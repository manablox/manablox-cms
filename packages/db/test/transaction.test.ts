import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRepositories, inTransaction, whenCommitted } from '../src/repositories/index.js';
import { createRepositoryContext, type RepositoryTestContext } from './helpers/repository.js';

let ctx: RepositoryTestContext;
let seq = 0;

beforeAll(async () => {
  ctx = await createRepositoryContext('transaction');
});
afterAll(async () => {
  await ctx?.close();
});

const space = (repos: typeof ctx.repos, name = `tx-${++seq}`) =>
  repos.spaces.create({ name, machineName: name, url: 'http://tx.test' });

describe('repos.transaction', () => {
  it('commits every write together, invisible outside until then', async () => {
    let seenOutside: unknown = 'unset';
    const id = await ctx.repos.transaction(async (tx) => {
      const row = await space(tx);
      await tx.roles.create(row.id, { name: 'Writer', machineName: 'writer', permissions: [] });
      seenOutside = await ctx.repos.spaces.findById(row.id);
      expect(await tx.spaces.findById(row.id)).not.toBeNull();
      return row.id;
    });
    expect(seenOutside).toBeNull();
    expect(await ctx.repos.spaces.findById(id)).not.toBeNull();
    expect(await ctx.repos.roles.listBySpace(id)).toHaveLength(1);
  });

  it('rolls every write back when `fn` throws', async () => {
    let id = '';
    await expect(
      ctx.repos.transaction(async (tx) => {
        id = (await space(tx)).id;
        await tx.roles.create(id, { name: 'Writer', machineName: 'writer', permissions: [] });
        throw new Error('midway');
      }),
    ).rejects.toThrow('midway');
    expect(id).not.toBe('');
    expect(await ctx.repos.spaces.findById(id)).toBeNull();
    expect(await ctx.repos.roles.listBySpace(id)).toHaveLength(0);
  });

  it('runs afterCommit callbacks in order once committed, never on rollback', async () => {
    const calls: string[] = [];
    const id = await ctx.repos.transaction(async (tx) => {
      const row = await space(tx);
      tx.afterCommit(async () => {
        // Committed by now, so the outer repos see it.
        calls.push((await ctx.repos.spaces.findById(row.id)) ? 'visible' : 'missing');
      });
      tx.afterCommit(() => calls.push('second'));
      expect(calls).toEqual([]);
      return row.id;
    });
    expect(id).toBeTruthy();
    expect(calls).toEqual(['visible', 'second']);

    await expect(
      ctx.repos.transaction(async (tx) => {
        tx.afterCommit(() => calls.push('rolled back'));
        throw new Error('nope');
      }),
    ).rejects.toThrow('nope');
    expect(calls).toEqual(['visible', 'second']);
  });

  it('surfaces a failing afterCommit callback after the rest ran, with the data committed', async () => {
    const calls: string[] = [];
    let id = '';
    await expect(
      ctx.repos.transaction(async (tx) => {
        id = (await space(tx)).id;
        tx.afterCommit(() => {
          throw new Error('listener');
        });
        tx.afterCommit(() => calls.push('ran'));
      }),
    ).rejects.toThrow('listener');
    expect(calls).toEqual(['ran']);
    expect(await ctx.repos.spaces.findById(id)).not.toBeNull();
  });

  it('tells transaction repositories apart and defers whenCommitted work inside them only', async () => {
    const calls: string[] = [];
    expect(inTransaction(ctx.repos)).toBe(false);
    await whenCommitted(ctx.repos, () => calls.push('now'));
    expect(calls).toEqual(['now']);

    await ctx.repos.transaction(async (tx) => {
      expect(inTransaction(tx)).toBe(true);
      await whenCommitted(tx, () => calls.push('committed'));
      await tx.transaction(async (nested) => {
        expect(inTransaction(nested)).toBe(true);
        await whenCommitted(nested, () => calls.push('nested'));
      });
      expect(calls).toEqual(['now']);
    });
    expect(calls).toEqual(['now', 'committed', 'nested']);

    await expect(
      ctx.repos.transaction(async (tx) => {
        await whenCommitted(tx, () => calls.push('rolled back'));
        throw new Error('nope');
      }),
    ).rejects.toThrow('nope');
    expect(calls).toEqual(['now', 'committed', 'nested']);
  });

  it('holds audit notifications until commit', async () => {
    const appended: string[] = [];
    const repos = createRepositories(ctx.handle, ctx.registry, {
      audit: { onAppended: (row) => appended.push(row.id) },
    });
    const entry = await repos.transaction(async (tx) => {
      const row = await tx.audit.append({ action: 'space.update', targetKind: 'space' });
      expect(appended).toEqual([]);
      return row;
    });
    expect(appended).toEqual([entry.id]);

    await expect(
      repos.transaction(async (tx) => {
        await tx.audit.append({ action: 'space.update', targetKind: 'space' });
        throw new Error('undo');
      }),
    ).rejects.toThrow('undo');
    expect(appended).toEqual([entry.id]);
  });

  it('writes recorded audit entries in order right before commit, dropping a failed savepoint', async () => {
    const before = await ctx.repos.audit.count({});
    const mark = (targetId: string) =>
      ({ action: 'space.update', targetKind: 'space', targetId }) as const;
    await ctx.repos.transaction(async (tx) => {
      expect(await tx.audit.record(mark('a'))).toBeNull();
      await tx.audit.recordMany([mark('b'), mark('c')]);
      await expect(
        tx.transaction(async (inner) => {
          await inner.audit.record(mark('dropped'));
          throw new Error('undo');
        }),
      ).rejects.toThrow('undo');
      await tx.transaction((inner) => inner.audit.record(mark('d')));
      // Queued, not yet written.
      expect(await tx.audit.count({})).toBe(before);
    });
    const page = await ctx.repos.audit.page(
      {},
      { by: 'at', direction: 'desc' },
      { limit: 4, offset: 0 },
    );
    expect(page.items.map((row) => row.targetId)).toEqual(['d', 'c', 'b', 'a']);
    const seqs = page.items.map((row) => row.seq);
    expect(new Set(seqs).size).toBe(4);
    expect([...seqs].sort((x, y) => y - x)).toEqual(seqs);
    expect((await ctx.repos.audit.verify()).ok).toBe(true);

    await expect(
      ctx.repos.transaction(async (tx) => {
        await tx.audit.record(mark('rolled back'));
        throw new Error('undo');
      }),
    ).rejects.toThrow('undo');
    expect(await ctx.repos.audit.count({})).toBe(before + 4);
  });

  it('nests as a savepoint: an inner failure rolls back only the inner writes', async () => {
    const calls: string[] = [];
    let inner = '';
    let second = '';
    const outer = await ctx.repos.transaction(async (tx) => {
      const row = await space(tx);
      tx.afterCommit(() => calls.push('outer'));
      await expect(
        tx.transaction(async (nested) => {
          inner = (await space(nested)).id;
          nested.afterCommit(() => calls.push('failed inner'));
          throw new Error('inner');
        }),
      ).rejects.toThrow('inner');
      second = await tx.transaction(async (nested) => {
        nested.afterCommit(() => calls.push('inner'));
        return (await space(nested)).id;
      });
      // Held for the outermost commit.
      expect(calls).toEqual([]);
      return row.id;
    });
    expect(calls).toEqual(['outer', 'inner']);
    expect(await ctx.repos.spaces.findById(outer)).not.toBeNull();
    expect(await ctx.repos.spaces.findById(second)).not.toBeNull();
    expect(await ctx.repos.spaces.findById(inner)).toBeNull();
  });

  it('rolls back a committed savepoint with its outer transaction', async () => {
    let inner = '';
    await expect(
      ctx.repos.transaction(async (tx) => {
        inner = await tx.transaction(async (nested) => (await space(nested)).id);
        throw new Error('outer');
      }),
    ).rejects.toThrow('outer');
    expect(await ctx.repos.spaces.findById(inner)).toBeNull();
  });

  it('runs concurrent transactions and plain writes without deadlocking', async () => {
    const before = (await ctx.repos.spaces.list()).length;
    const results = await Promise.all([
      ...Array.from({ length: 12 }, (_, i) =>
        ctx.repos.transaction(async (tx) => {
          const row = await space(tx, `concurrent-${i}`);
          await tx.roles.create(row.id, { name: 'Writer', machineName: 'writer', permissions: [] });
          // Reads through the transaction see its own writes.
          expect(await tx.roles.listBySpace(row.id)).toHaveLength(1);
          return row.id;
        }),
      ),
      ...Array.from({ length: 6 }, (_, i) => space(ctx.repos, `plain-${i}`).then((row) => row.id)),
    ]);
    expect(new Set(results).size).toBe(18);
    expect((await ctx.repos.spaces.list()).length).toBe(before + 18);
  });
});
