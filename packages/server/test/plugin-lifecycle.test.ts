import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { definePlugin, type ManabloxConfig } from '@manablox/core';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { bootstrap, type Runtime } from '../src/bootstrap.js';
import { pluginServer } from '../src/surfaces/plugins.js';

const events: string[] = [];

const plugin = definePlugin({
  name: 'lifecycle',
  controls: {
    'rateLimits.plugins.lifecycle.incoming': {
      description: 'Signed calls per IP.',
      default: { max: 2, windowSeconds: 60 },
    },
  },
  start: (context) => {
    events.push(`start:${context.id}`);
  },
  stop: () => {
    events.push('stop');
  },
  server: pluginServer({
    routes: [
      {
        scopes: ['management'],
        register(app, helpers) {
          // Anonymous, with the exact bytes, as a signature check needs them.
          app.post('/in/:spaceId', helpers.rateLimit('plugins.lifecycle.incoming'), async (c) => {
            const raw = await c.req.arrayBuffer();
            const digest = createHash('sha256').update(Buffer.from(raw)).digest('hex');
            return c.json({ digest, caller: await helpers.principal(c) });
          });
        },
      },
    ],
  }),
});

let db: TestDatabase;
let dir: string;
const runtimes: Runtime[] = [];

const boot = async (mode: 'management' | 'public', cache: ManabloxConfig['cache'] = {}) => {
  const runtime = await bootstrap({
    database: { url: db.url },
    auth: { secret: 'plugin-lifecycle-secret' },
    fieldTypes: builtinFieldTypes,
    plugins: [plugin],
    logLevel: 'silent',
    cache,
    storage: { driver: 'local', local: { path: join(dir, 'files') } },
    server: { mode, ...(mode === 'management' ? { scopes: ['rpc', 'auth'] } : {}) },
  });
  runtimes.push(runtime);
  return runtime;
};

beforeAll(async () => {
  db = await createTestDatabase('plugin_lifecycle');
  dir = await mkdtemp(join(tmpdir(), 'manablox-lifecycle-'));
}, 60_000);

afterAll(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.shutdown();
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('plugin lifecycle', () => {
  it('starts plugins on management instances only and stops them on shutdown', async () => {
    events.length = 0;
    const pub = await boot('public');
    expect(events).toEqual([]);
    const api = await boot('management');
    expect(events).toEqual(['start:lifecycle']);
    await api.shutdown();
    await pub.shutdown();
    expect(events).toEqual(['start:lifecycle', 'stop']);
  });
});

describe('plugin routes', () => {
  it('take anonymous posts with their raw body, under the plugin rate limit', async () => {
    const api = await boot('management');
    const app = await createApp(api);
    const space = await api.repos.spaces.create({
      name: 'Lifecycle',
      machineName: 'lifecycle',
      url: 'https://lifecycle.test',
      defaultLocale: 'en',
      locales: ['en'],
    });
    const body = '{"b": 1,  "a": [2]}';
    const post = () =>
      app.request(`/plugins/lifecycle/in/${space.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
        body,
      });

    const first = await post();
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      digest: createHash('sha256').update(body).digest('hex'),
      caller: null,
    });
    expect(first.headers.get('ratelimit-limit')).toBe('2');
    expect((await post()).status).toBe(200);
    const refused = await post();
    expect(refused.status).toBe(429);
    expect((await refused.json()).error.key).toBe('rateLimit.exceeded');
    expect(refused.headers.get('retry-after')).not.toBeNull();
  });
});

const redisUrl = process.env.TEST_REDIS_URL ?? '';

describe('plugin channels without Redis', () => {
  it('send nothing', async () => {
    const api = await boot('management');
    const channel = api.manablox.plugin('lifecycle').channel<{ spaceId: string }>('live');
    expect(api.manablox.plugin('lifecycle').channel('live')).toBe(channel);
    const listener = vi.fn();
    channel.subscribe(listener);
    channel.publish({ spaceId: 'a' });
    expect(listener).not.toHaveBeenCalled();
    expect(() => api.manablox.plugin('lifecycle').channel('no spaces')).toThrow();
  });
});

describe.skipIf(!redisUrl)('plugin channels over Redis', () => {
  it('carry JSON messages to the other processes', async () => {
    const sender = await boot('management', { redisUrl });
    const receiver = await boot('public', { redisUrl });
    const own = vi.fn();
    const other = vi.fn();
    const received = vi.fn();
    sender.manablox.plugin('lifecycle').channel('live').subscribe(own);
    receiver.manablox.plugin('lifecycle').channel('other').subscribe(other);
    const unsubscribe = receiver.manablox.plugin('lifecycle').channel('live').subscribe(received);
    // Subscribing is asynchronous; a message before it would be missed.
    await new Promise((resolve) => setTimeout(resolve, 200));

    sender.manablox.plugin('lifecycle').channel('live').publish({ spaceId: 'space-1' });
    await vi.waitFor(() => expect(received).toHaveBeenCalledWith({ spaceId: 'space-1' }));
    unsubscribe();
    sender.manablox.plugin('lifecycle').channel('live').publish({ spaceId: 'space-2' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(received).toHaveBeenCalledTimes(1);
    expect(own).not.toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
  });
});
