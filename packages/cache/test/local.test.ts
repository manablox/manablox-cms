import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalCache } from '../src/index.js';

afterEach(() => {
  vi.useRealTimers();
});

const loaded =
  (value: string, tags: string[] = []) =>
  async () => ({ value, tags });

describe('LocalCache', () => {
  it('keeps a loaded value until its time is up', async () => {
    vi.useFakeTimers();
    const cache = new LocalCache<string>({ max: 10, ttlMs: 1000 });
    const load = vi.fn(loaded('a'));
    expect(await cache.load('k', load)).toBe('a');
    expect(await cache.load('k', load)).toBe('a');
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1001);
    expect(cache.get('k')).toBeUndefined();
    await cache.load('k', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('drops the least recently used entry past its size', () => {
    const cache = new LocalCache<number>({ max: 2, ttlMs: 60_000 });
    cache.set('a', 1, []);
    cache.set('b', 2, []);
    cache.get('a');
    cache.set('c', 3, []);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });

  it('drops exactly the entries carrying a purged tag', () => {
    const cache = new LocalCache<number>({ max: 10, ttlMs: 60_000 });
    cache.set('one', 1, ['space:1', 'domains']);
    cache.set('two', 2, ['space:2']);
    cache.purge(['space:1']);
    expect(cache.get('one')).toBeUndefined();
    expect(cache.get('two')).toBe(2);
    cache.purge(['domains']);
    expect(cache.size).toBe(1);
  });

  it('shares one load between concurrent misses', async () => {
    const cache = new LocalCache<string>({ max: 10, ttlMs: 60_000 });
    let resolve: (value: { value: string; tags: string[] }) => void = () => {};
    const load = vi.fn(() => new Promise<{ value: string; tags: string[] }>((r) => (resolve = r)));
    const first = cache.load('k', load);
    const second = cache.load('k', load);
    resolve({ value: 'v', tags: [] });
    expect(await first).toBe('v');
    expect(await second).toBe('v');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not keep a value whose load a purge overtook', async () => {
    const cache = new LocalCache<string>({ max: 10, ttlMs: 60_000 });
    let resolve: (value: { value: string; tags: string[] }) => void = () => {};
    const stale = cache.load('k', () => new Promise((r) => (resolve = r)));
    cache.purge(['anything']);
    resolve({ value: 'old', tags: ['anything'] });
    expect(await stale).toBe('old');
    expect(cache.get('k')).toBeUndefined();
    expect(await cache.load('k', loaded('new'))).toBe('new');
    expect(cache.get('k')).toBe('new');
  });

  it('keeps nothing when disabled: every load runs', async () => {
    const cache = new LocalCache<string>({ max: 10, ttlMs: 60_000, disabled: true });
    const load = vi.fn(loaded('a', ['space:1']));
    expect(await cache.load('k', load)).toBe('a');
    expect(await cache.load('k', load)).toBe('a');
    expect(load).toHaveBeenCalledTimes(2);
    cache.set('k', 'b', []);
    expect(cache.get('k')).toBeUndefined();
    expect(cache.size).toBe(0);
  });
});
