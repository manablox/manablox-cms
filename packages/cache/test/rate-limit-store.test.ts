import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  backoffFor,
  createRedis,
  memoryRateLimitStore,
  type RateLimitRedisClient,
  type RateLimitStore,
  redisRateLimitStore,
} from '../src/index.js';

const check = (key: string, max: number, window = 1_000) => ({ key, max, window });

describe('memory rate-limit store', () => {
  let clock = 0;
  const store = () => memoryRateLimitStore({ now: () => clock });

  afterEach(() => {
    clock = 0;
  });

  it('allows max hits per window, then refuses without counting', () => {
    clock = 10_000;
    const limits = store();
    expect(limits.consume([check('a', 3)])).toEqual({
      allowed: true,
      index: 0,
      limit: 3,
      remaining: 2,
      reset: 1_000,
    });
    limits.consume([check('a', 3)]);
    expect(limits.consume([check('a', 3)])).toMatchObject({ allowed: true, remaining: 0 });
    const refused = limits.consume([check('a', 3)]);
    expect(refused).toMatchObject({ allowed: false, limit: 3, remaining: 0 });
    // In the next window this one's three still weigh fully, then fade.
    expect(refused.reset).toBe(1_334);
    expect(limits.consume([check('b', 3)])).toMatchObject({ allowed: true });
  });

  it('slides: the previous window counts by how much of it still overlaps', () => {
    clock = 10_000;
    const limits = store();
    for (let i = 0; i < 4; i++) limits.consume([check('a', 4)]);
    // Next window start: 4 * 1.0 = 4 in use, nothing left.
    clock = 11_000;
    expect(limits.consume([check('a', 4)]).allowed).toBe(false);
    // Halfway: 4 * 0.5 = 2 in use, so two more fit.
    clock = 11_500;
    expect(limits.consume([check('a', 4)])).toMatchObject({ allowed: true, remaining: 1 });
    expect(limits.consume([check('a', 4)])).toMatchObject({ allowed: true, remaining: 0 });
    const refused = limits.consume([check('a', 4)]);
    expect(refused.allowed).toBe(false);
    // Room again once the previous share drops to 1: at 75 % of the window.
    expect(refused.reset).toBe(250);
    clock = 11_750;
    expect(limits.consume([check('a', 4)]).allowed).toBe(true);
    // Two windows later everything is forgotten.
    clock = 13_000;
    expect(limits.consume([check('a', 4)])).toMatchObject({ allowed: true, remaining: 3 });
  });

  it('counts a batch only when every check passes, and names the one that decided', () => {
    clock = 5_000;
    const limits = store();
    limits.consume([check('ip', 1)]);
    const refused = limits.consume([check('space', 5), check('ip', 1)]);
    expect(refused).toMatchObject({ allowed: false, index: 1 });
    // The refused batch did not count against `space`.
    expect(limits.consume([check('space', 5)])).toMatchObject({ remaining: 4 });
    expect(limits.consume([check('space', 5), check('other', 2)])).toMatchObject({
      allowed: true,
      index: 1,
      remaining: 1,
    });
  });

  it('refuses everything at max 0', () => {
    const limits = store();
    expect(limits.consume([check('a', 0)])).toMatchObject({ allowed: false, reset: 1_000 });
  });

  it('holds at most max slots until released or expired', () => {
    const limits = store();
    const first = limits.acquire('runs', 2, 1_000) as string;
    expect(first).toBeTruthy();
    expect(limits.acquire('runs', 2, 1_000)).toBeTruthy();
    expect(limits.acquire('runs', 2, 1_000)).toBeNull();
    limits.release('runs', first);
    expect(limits.acquire('runs', 2, 1_000)).toBeTruthy();
    clock = 1_000;
    expect(limits.acquire('runs', 2, 1_000)).toBeTruthy();
  });

  it('backs off after the allowance and forgets on clear', () => {
    clock = 1_000;
    const limits = store();
    const policy = { attempts: 2, window: 60_000, maxDelay: 30_000 };
    limits.fail(['ip:a'], policy);
    limits.fail(['ip:a'], policy);
    expect(limits.blocked(['ip:a'])).toBe(0);
    limits.fail(['ip:a', 'account:x'], policy);
    expect(limits.blocked(['ip:a'])).toBe(1_000);
    expect(limits.blocked(['account:x'])).toBe(0);
    limits.fail(['ip:a'], policy);
    expect(limits.blocked(['ip:b', 'ip:a'])).toBe(2_000);
    limits.clear(['ip:a']);
    expect(limits.blocked(['ip:a'])).toBe(0);
  });
});

describe('backoff', () => {
  it('is free until the allowance is spent, then doubles up to the cap', () => {
    expect(backoffFor(3, 3, 30_000)).toBe(0);
    expect(backoffFor(4, 3, 30_000)).toBe(1_000);
    expect(backoffFor(6, 3, 30_000)).toBe(4_000);
    expect(backoffFor(40, 3, 30_000)).toBe(30_000);
  });
});

describe('redis rate-limit store', () => {
  it('prefixes keys and maps the script result', async () => {
    const calls: unknown[][] = [];
    const redis: RateLimitRedisClient = {
      eval: async () => {
        throw new Error('unexpected EVAL');
      },
      async evalsha(...args) {
        calls.push(args);
        return [0, 2, 5, 0, 1500];
      },
      async quit() {},
    };
    const outcome = await redisRateLimitStore(redis).consume([check('a', 3), check('b', 5, 60)]);
    expect(outcome).toEqual({ allowed: false, index: 1, limit: 5, remaining: 0, reset: 1500 });
    expect(calls[0]?.[0]).toMatch(/^[0-9a-f]{40}$/);
    expect(calls[0]?.slice(1)).toEqual([2, 'manablox:rl:a', 'manablox:rl:b', 3, 1_000, 5, 60]);
  });

  it('falls back to EVAL with the same arguments when the script is not cached', async () => {
    const evals: unknown[][] = [];
    const redis: RateLimitRedisClient = {
      async eval(...args) {
        evals.push(args);
        return 1;
      },
      evalsha: async () => {
        throw new Error('NOSCRIPT No matching script. Please use EVAL.');
      },
      async quit() {},
    };
    expect(await redisRateLimitStore(redis).acquire('k', 2, 500)).toEqual(expect.any(String));
    expect(evals[0]?.[0]).toContain('ZCARD');
    expect(evals[0]?.slice(1, 5)).toEqual([1, 'manablox:rl:slot:k', 2, 500]);
  });

  it('passes other errors through', async () => {
    const redis: RateLimitRedisClient = {
      eval: vi.fn(async () => 1),
      evalsha: async () => {
        throw new Error('READONLY');
      },
      async quit() {},
    };
    await expect(redisRateLimitStore(redis).blocked(['a'])).rejects.toThrow('READONLY');
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('leaves the client it was given open: its owner closes it', async () => {
    const redis: RateLimitRedisClient = {
      eval: async () => 1,
      evalsha: async () => 1,
      quit: vi.fn(async () => 'OK'),
    };
    await redisRateLimitStore(redis).close?.();
    expect(redis.quit).not.toHaveBeenCalled();
  });
});

const redisUrl = process.env.TEST_REDIS_URL ?? '';

describe.skipIf(!redisUrl)('redis rate-limit store over Redis', () => {
  const stores: RateLimitStore[] = [];
  const open = (prefix: string) => {
    const store = redisRateLimitStore(redisUrl, { prefix });
    stores.push(store);
    return store;
  };

  afterEach(async () => {
    for (const store of stores.splice(0)) await store.close?.();
  });

  it('shares one budget between stores and never loses a concurrent hit', async () => {
    const prefix = `rl-test:${Date.now()}:${Math.random()}:`;
    const a = open(prefix);
    const b = open(prefix);
    const first = await a.consume([check('client', 5, 60_000)]);
    expect(first).toMatchObject({ allowed: true, limit: 5, remaining: 4 });
    expect(first.reset).toBeGreaterThan(0);
    expect(first.reset).toBeLessThanOrEqual(60_000);
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, (_, i) => (i % 2 ? a : b).consume([check('client', 5, 60_000)])),
    );
    expect(outcomes.filter((outcome) => outcome.allowed)).toHaveLength(4);
    const refused = outcomes.find((outcome) => !outcome.allowed);
    expect(refused?.reset).toBeGreaterThan(0);
    expect(refused?.reset).toBeLessThanOrEqual(120_000);
  });

  it('counts a batch only when every check passes', async () => {
    const store = open(`rl-test:${Date.now()}:${Math.random()}:`);
    await store.consume([check('ip', 1, 60_000)]);
    const refused = await store.consume([check('space', 5, 60_000), check('ip', 1, 60_000)]);
    expect(refused).toMatchObject({ allowed: false, index: 1 });
    expect(await store.consume([check('space', 5, 60_000)])).toMatchObject({ remaining: 4 });
  });

  it('slides into the next window', async () => {
    const store = open(`rl-test:${Date.now()}:${Math.random()}:`);
    const window = 400;
    // Start right after a window boundary so the test stays inside it.
    await new Promise((resolve) => setTimeout(resolve, window - (Date.now() % window) + 5));
    for (let i = 0; i < 2; i++) await store.consume([check('a', 2, window)]);
    expect((await store.consume([check('a', 2, window)])).allowed).toBe(false);
    // Early in the next window the previous two still weigh almost fully.
    await new Promise((resolve) => setTimeout(resolve, window - (Date.now() % window) + 20));
    expect((await store.consume([check('a', 2, window)])).allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, window * 2));
    expect(await store.consume([check('a', 2, window)])).toMatchObject({ allowed: true });
  });

  it('holds slots and backoff across stores', async () => {
    const prefix = `rl-test:${Date.now()}:${Math.random()}:`;
    const a = open(prefix);
    const b = open(prefix);
    const token = (await a.acquire('runs', 1, 10_000)) as string;
    expect(token).toBeTruthy();
    expect(await b.acquire('runs', 1, 10_000)).toBeNull();
    await a.release('runs', token);
    expect(await b.acquire('runs', 1, 10_000)).toBeTruthy();

    const policy = { attempts: 1, window: 60_000, maxDelay: 30_000 };
    await a.fail(['ip:x'], policy);
    expect(await b.blocked(['ip:x'])).toBe(0);
    await a.fail(['ip:x'], policy);
    const wait = await b.blocked(['ip:y', 'ip:x']);
    expect(wait).toBeGreaterThan(900);
    expect(wait).toBeLessThanOrEqual(1_000);
    await b.clear(['ip:x']);
    expect(await a.blocked(['ip:x'])).toBe(0);
  });

  it('reloads its scripts after Redis dropped them', async () => {
    const store = open(`rl-test:${Date.now()}:${Math.random()}:`);
    expect(await store.consume([check('a', 2, 60_000)])).toMatchObject({ remaining: 1 });
    const admin = createRedis(redisUrl, 'rateLimit');
    try {
      await admin.script('FLUSH');
    } finally {
      await admin.quit();
    }
    expect(await store.consume([check('a', 2, 60_000)])).toMatchObject({ remaining: 0 });
  });
});
