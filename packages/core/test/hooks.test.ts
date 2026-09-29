import { describe, expect, it, vi } from 'vitest';
import type { ManabloxConfig } from '../src/config.js';
import { ManabloxError } from '../src/errors.js';
import { HookBus } from '../src/hooks.js';
import { Manablox } from '../src/manablox.node.js';
import { definePlugin, onHook } from '../src/plugin.js';

type TestHooks = {
  a: [{ n: number }, { tag: string }];
  noop: [undefined, Record<string, never>];
};

describe('HookBus', () => {
  it('awaits async handlers', async () => {
    const bus = new HookBus<TestHooks>();
    const order: string[] = [];

    bus.on('a', async (payload) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push('slow');
      return { n: payload.n + 1 };
    });
    bus.on('a', (payload) => {
      order.push('fast');
      return { n: payload.n * 2 };
    });

    const result = await bus.run('a', { n: 1 }, { tag: 't' });

    expect(order).toEqual(['slow', 'fast']);
    expect(result).toEqual({ n: 4 });
  });

  it('threads the payload through handlers - return values were discarded before', async () => {
    const bus = new HookBus<TestHooks>();
    bus.on('a', (p) => ({ n: p.n + 1 }));
    bus.on('a', (p) => ({ n: p.n + 1 }));
    bus.on('a', (p) => ({ n: p.n + 1 }));

    expect(await bus.run('a', { n: 0 }, { tag: 't' })).toEqual({ n: 3 });
  });

  it('leaves the payload untouched when a handler returns undefined', async () => {
    const bus = new HookBus<TestHooks>();
    const observer = vi.fn();
    bus.on('a', (p) => {
      observer(p);
    });

    expect(await bus.run('a', { n: 7 }, { tag: 't' })).toEqual({ n: 7 });
    expect(observer).toHaveBeenCalledWith({ n: 7 });
  });

  it('orders by priority - the priority field existed but was never read', async () => {
    const bus = new HookBus<TestHooks>();
    const order: number[] = [];

    bus.on(
      'a',
      () => {
        order.push(3);
      },
      { priority: 300 },
    );
    bus.on(
      'a',
      () => {
        order.push(1);
      },
      { priority: 10 },
    );
    bus.on(
      'a',
      () => {
        order.push(2);
      },
      { priority: 100 },
    );

    await bus.run('a', { n: 0 }, { tag: 't' });
    expect(order).toEqual([1, 2, 3]);
  });

  it('keeps registration order stable within one priority', async () => {
    const bus = new HookBus<TestHooks>();
    const order: string[] = [];
    for (const name of ['a', 'b', 'c', 'd']) {
      bus.on(
        'a',
        () => {
          order.push(name);
        },
        { priority: 50 },
      );
    }
    await bus.run('a', { n: 0 }, { tag: 't' });
    expect(order).toEqual(['a', 'b', 'c', 'd']);
  });

  it('propagates handler errors by default', async () => {
    const bus = new HookBus<TestHooks>();
    bus.on('a', () => {
      throw new Error('boom');
    });
    await expect(bus.run('a', { n: 0 }, { tag: 't' })).rejects.toThrow('boom');
  });

  it('continues when onError swallows, and reports the source', async () => {
    const onError = vi.fn().mockReturnValue(true);
    const bus = new HookBus<TestHooks>({ onError });
    bus.on(
      'a',
      () => {
        throw new Error('boom');
      },
      { source: 'plugin-x' },
    );
    bus.on('a', (p) => ({ n: p.n + 1 }));

    expect(await bus.run('a', { n: 0 }, { tag: 't' })).toEqual({ n: 1 });
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'a', 'plugin-x');
  });

  it('unregisters via the returned disposer', async () => {
    const bus = new HookBus<TestHooks>();
    const off = bus.on('a', (p) => ({ n: p.n + 100 }));
    expect(await bus.run('a', { n: 0 }, { tag: 't' })).toEqual({ n: 100 });
    off();
    expect(await bus.run('a', { n: 0 }, { tag: 't' })).toEqual({ n: 0 });
    expect(bus.has('a')).toBe(false);
  });

  it('observe hands every handler the same payload and reports errors without throwing', async () => {
    const failures: string[] = [];
    const bus = new HookBus<TestHooks>({ onError: (_error, hook) => void failures.push(hook) });
    const seen: number[] = [];
    bus.on('a', (payload) => {
      seen.push(payload.n);
      throw new Error('boom');
    });
    bus.on('a', (payload) => {
      seen.push(payload.n);
      return { n: 99 };
    });

    await expect(bus.observe('a', { n: 1 }, { tag: 't' })).resolves.toBeUndefined();
    expect(seen).toEqual([1, 1]);
    expect(failures).toEqual(['a']);
  });
});

describe('Manablox hook errors', () => {
  it('logs refusals at debug and other failures at error', async () => {
    const lines: { level: number; msg: string }[] = [];
    const manablox = new Manablox({
      database: { url: 'postgres://unused' },
      auth: { secret: 'test' },
      fieldTypes: [],
      contentTypes: [],
      logging: {
        level: 'debug',
        adapters: [
          { name: 'capture', stream: { write: (line: string) => lines.push(JSON.parse(line)) } },
        ],
      },
    } as unknown as ManabloxConfig);
    const off = manablox.hooks.on('cache:purge', () => {
      throw ManabloxError.conflict('control.limit');
    });
    const context = { manablox, spaceId: null };
    await expect(manablox.hooks.run('cache:purge', { tags: [] }, context)).rejects.toThrow();
    off();
    manablox.hooks.on('cache:purge', () => {
      throw new Error('broken');
    });
    await expect(manablox.hooks.run('cache:purge', { tags: [] }, context)).rejects.toThrow();
    await manablox.stop();

    expect(lines.map((line) => [line.level, line.msg])).toEqual([
      [20, 'hook handler refused'],
      [50, 'hook handler failed'],
    ]);
  });
});

describe('plugin hooks', () => {
  it('gates declared hooks by the plugin flag, spaceless ones run', async () => {
    const seen: string[] = [];
    const manablox = new Manablox({
      database: { url: 'postgres://unused' },
      auth: { secret: 'test' },
      fieldTypes: [],
      contentTypes: [],
      logging: { level: 'error' },
      plugins: [
        definePlugin({
          name: '@acme/seo',
          hooks: () => [
            onHook('menu:afterWrite', (payload) => {
              seen.push(`declared:${payload.spaceId}`);
            }),
            onHook('cache:purge', () => void seen.push('declared:spaceless')),
          ],
        }),
      ],
    } as unknown as ManabloxConfig);
    manablox.setControls({
      feature: async (spaceId: string | null, key: string) => ({
        enabled: !(spaceId === 'off' && key === 'plugins.acme.seo'),
      }),
    } as never);
    await manablox.init();

    for (const spaceId of ['on', 'off']) {
      await manablox.hooks.run('menu:afterWrite', { id: 'm', spaceId }, { manablox, spaceId });
    }
    await manablox.hooks.run('cache:purge', { tags: [] }, { manablox, spaceId: null });
    await manablox.stop();

    expect(seen).toEqual(['declared:on', 'declared:spaceless']);
    expect(manablox.hooks.describe()['menu:afterWrite']?.map((entry) => entry.source)).toEqual([
      '@acme/seo',
    ]);
  });
});
