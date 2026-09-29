import type { ManabloxConfig } from '@manablox/core';
import { Manablox } from '@manablox/core/node';
import { Redis } from 'ioredis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachInvalidation, redisHub } from '../src/index.js';

const instances: Manablox[] = [];

function instance(cache: ManabloxConfig['cache']): Manablox {
  const manablox = new Manablox({
    database: { url: 'postgres://unused' },
    auth: { secret: 'test' },
    fieldTypes: [],
    contentTypes: [],
    cache,
    logging: { adapters: [{ name: 'discard', stream: { write() {} } }] },
  } as unknown as ManabloxConfig);
  instances.push(manablox);
  return manablox;
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map((manablox) => manablox.stop()));
});

describe('the Redis hub without Redis', () => {
  it('is absent', () => {
    expect(redisHub(instance({}))).toBeNull();
  });
});

const testUrl = process.env.TEST_REDIS_URL ?? '';
/** A database of its own, so connections of other suites running meanwhile do not count. */
const HUB_DB = 14;
const redisUrl = testUrl ? `${testUrl.replace(/\/\d*$/, '')}/${HUB_DB}` : '';

/** Client list lines of `name` in the hub tests' database. */
async function clients(name: string): Promise<string[]> {
  const probe = new Redis(redisUrl);
  try {
    const list = String(await probe.client('LIST'));
    return list
      .split('\n')
      .filter((line) => line.includes(`name=${name} `) && line.includes(` db=${HUB_DB} `));
  } finally {
    probe.disconnect();
  }
}
const connections = async (name: string) => (await clients(name)).length;

describe.skipIf(!redisUrl)('the Redis hub', () => {
  it('holds one command and one subscriber connection however many channels listen', async () => {
    const before = [
      await connections('manablox:command'),
      await connections('manablox:subscriber'),
    ];
    const one = instance({ redisUrl });
    const hub = redisHub(one);
    expect(redisHub(one)).toBe(hub);
    for (const kind of ['a', 'b', 'c', 'd']) attachInvalidation(one, kind, () => {});
    await hub?.command.ping();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await connections('manablox:command')).toBe((before[0] ?? 0) + 1);
    expect(await connections('manablox:subscriber')).toBe((before[1] ?? 0) + 1);
    await one.stop();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await connections('manablox:command')).toBe(before[0]);
    expect(await connections('manablox:subscriber')).toBe(before[1]);
  });

  it('keeps each channel to its own listeners, across processes', async () => {
    const sender = redisHub(instance({ redisUrl }));
    const receiver = redisHub(instance({ redisUrl }));
    const first = vi.fn();
    const second = vi.fn();
    const off = receiver?.subscribe('manablox:test:first', first);
    receiver?.subscribe('manablox:test:second', second);
    await new Promise((resolve) => setTimeout(resolve, 200));

    sender?.publish('manablox:test:first', 'one');
    sender?.publish('manablox:test:second', 'two');
    await vi.waitFor(() => expect(second).toHaveBeenCalledWith('two'));
    expect(first).toHaveBeenCalledWith('one');
    expect(first).toHaveBeenCalledTimes(1);

    off?.();
    sender?.publish('manablox:test:first', 'three');
    sender?.publish('manablox:test:second', 'four');
    await vi.waitFor(() => expect(second).toHaveBeenCalledWith('four'));
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('tells every channel after the subscriber reconnects', async () => {
    const one = instance({ redisUrl });
    const drops: Array<string | undefined> = [];
    attachInvalidation(one, 'things', (key) => drops.push(key));
    attachInvalidation(one, 'others', (key) => drops.push(`others:${key}`));
    await new Promise((resolve) => setTimeout(resolve, 200));
    // Kill this process's subscriber from the server's side; the client reconnects.
    const id = /\bid=(\d+)/.exec((await clients('manablox:subscriber'))[0] ?? '')?.[1];
    expect(id).toBeDefined();
    const probe = new Redis(redisUrl);
    try {
      await probe.client('KILL', 'ID', id as string);
    } finally {
      probe.disconnect();
    }
    await vi.waitFor(
      () => expect(drops).toEqual(expect.arrayContaining([undefined, 'others:undefined'])),
      {
        timeout: 5000,
      },
    );
  });
});
