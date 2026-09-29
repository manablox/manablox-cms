import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/client.js';
import { createRepositories } from '../src/repositories/index.js';
import { TEST_DIALECT } from '../src/testing.js';
import { createRepositoryContext, type RepositoryTestContext } from './helpers/repository.js';

let ctx: RepositoryTestContext;

beforeAll(async () => {
  ctx = await createRepositoryContext('lock');
});
afterAll(async () => {
  await ctx?.close();
});

/** A promise with its resolver, to hold a lock open until the test lets go. */
const gate = () => {
  let open = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
};

const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

describe('locks.withLock', () => {
  it('returns the result of fn', async () => {
    expect(await ctx.repos.locks.withLock('result', async () => 42)).toBe(42);
  });

  it('runs holders of one name one after another', async () => {
    const events: string[] = [];
    const hold = gate();
    const first = ctx.repos.locks.withLock('serial', async () => {
      events.push('first:start');
      await hold.promise;
      events.push('first:end');
    });
    await tick();
    const second = ctx.repos.locks.withLock('serial', async () => {
      events.push('second:start');
    });
    await tick();
    expect(events).toEqual(['first:start']);
    hold.open();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('lets holders of different names run at the same time', async () => {
    const hold = gate();
    const events: string[] = [];
    const first = ctx.repos.locks.withLock('name-a', async () => {
      events.push('a:start');
      await hold.promise;
    });
    await tick();
    await ctx.repos.locks.withLock('name-b', async () => {
      events.push('b');
    });
    expect(events).toEqual(['a:start', 'b']);
    hold.open();
    await first;
  });

  it('releases the lock when fn throws', async () => {
    await expect(
      ctx.repos.locks.withLock('throws', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await ctx.repos.locks.withLock('throws', async () => 'next')).toBe('next');
  });

  it('keeps writes made while holding the lock', async () => {
    const space = await ctx.repos.locks.withLock('writes', () =>
      ctx.repos.spaces.create({ name: 'Locked', machineName: 'locked', url: 'http://l.test' }),
    );
    expect(await ctx.repos.spaces.findById(space.id)).not.toBeNull();
  });

  // Postgres advisory locks span connections; SQLite orders holders within one process.
  it.runIf(TEST_DIALECT === 'postgres')('serialises holders on separate connections', async () => {
    const second = await createDatabase({ url: ctx.url, max: 2 });
    try {
      const otherRepos = createRepositories(second, ctx.registry);
      const events: string[] = [];
      const hold = gate();
      const first = ctx.repos.locks.withLock('cross', async () => {
        events.push('first:start');
        await hold.promise;
        events.push('first:end');
      });
      await tick();
      const other = otherRepos.locks.withLock('cross', async () => {
        events.push('other');
      });
      await tick(100);
      expect(events).toEqual(['first:start']);
      hold.open();
      await Promise.all([first, other]);
      expect(events).toEqual(['first:start', 'first:end', 'other']);
    } finally {
      await second.close();
    }
  });
});
