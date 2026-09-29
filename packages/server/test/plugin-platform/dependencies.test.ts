import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginRouterClient } from '@manablox/api-rpc/plugin';
import { definePlugin, type ManabloxConfig, resolveConfig } from '@manablox/core';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import { createORPCClient, ORPCError } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import {
  bootstrap,
  type ManagementRuntime,
  type Runtime,
  requireManagement,
} from '../../src/bootstrap.js';
import { helloRepos } from '../fixtures/plugins/hello/db.js';
import { helloPlugin } from '../fixtures/plugins/hello/plugin.js';
import { helloExtraRepos } from '../fixtures/plugins/hello-extra/db.js';
import { type HelloExtraRouter, helloExtraPlugin } from '../fixtures/plugins/hello-extra/plugin.js';

const KEY = 'hello-extra-key-0123456789abcdef';

let db: TestDatabase;
let dir: string;
let api: ManagementRuntime;
let app: Awaited<ReturnType<typeof createApp>>;
let spaceId: string;
let ownerId: string;
let rootKey: string;
let seq = 0;
const runtimes: Runtime[] = [];

type Client = PluginRouterClient<HelloExtraRouter>;

/** The management client's `plugins.hello-extra`, as an API key. */
const client = (key: string): Client => {
  const link = new RPCLink({
    url: 'http://extra.test/rpc',
    headers: { 'x-api-key': key },
    fetch: async (request) => app.request(request),
  });
  return (createORPCClient(link) as { plugins: { 'hello-extra': Client } }).plugins['hello-extra'];
};

const control = async (path: string, method: string, body?: unknown) => {
  const response = await app.request(`/control/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${KEY}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  expect(response.status).toBeLessThan(300);
  api.controlStore.forget(null);
  return response;
};
const set = (scope: string, values: Record<string, unknown>) =>
  control(`/settings?scope=${scope}`, 'PATCH', values);
const unset = (scope: string, key: string) => control(`/settings/${key}?scope=${scope}`, 'DELETE');

/** The two plugins, the one that requires the other listed first. */
const config = (options: Partial<ManabloxConfig> = {}): ManabloxConfig => ({
  database: { url: db.url },
  auth: { secret: 'hello-extra-secret' },
  fieldTypes: builtinFieldTypes,
  plugins: [helloExtraPlugin(), helloPlugin()],
  logLevel: 'silent',
  storage: { driver: 'local', local: { path: join(dir, 'files') } },
  server: { rateLimit: { window: 60_000, max: 10_000 }, scopes: ['rpc', 'auth', 'control'] },
  control: { apiKey: KEY },
  ...options,
});

/** The board of a runtime, through the typed plugin lookup. */
const boardOf = (runtime: Runtime) => {
  const services = runtime.manablox.plugins.get('hello-extra');
  if (!services) throw new Error('hello-extra is not configured');
  return services.board;
};

async function freshSpace(): Promise<string> {
  const name = `extra-${++seq}`;
  const space = await api.spaces.create({ name, machineName: name, url: 'http://x.test' }, null);
  return space.id;
}

beforeAll(async () => {
  db = await createTestDatabase('hello_extra', { plugins: [helloPlugin(), helloExtraPlugin()] });
  dir = await mkdtemp(join(tmpdir(), 'manablox-hello-extra-'));
  api = requireManagement(await bootstrap(config()));
  runtimes.push(api);
  app = await createApp(api);
  const admin = await api.repos.users.create({
    name: 'Admin',
    email: 'admin@extra.test',
    role: 'superadmin',
    passwordHash: 'x',
  });
  ownerId = admin.id;
  rootKey = (await api.apiKeys.issue(admin.id, 'root')).key;
  spaceId = await freshSpace();
}, 60_000);

afterEach(async () => {
  for (const key of ['features.plugins.hello', 'features.plugins.hello-extra']) {
    for (const scope of ['instance', `space:${spaceId}`]) await unset(scope, key);
  }
});

afterAll(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.shutdown();
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('plugin dependencies', () => {
  it('boots a plugin after the one it requires', () => {
    expect(api.manablox.config.plugins.map((plugin) => plugin.name)).toEqual([
      'hello',
      'hello-extra',
    ]);
  });

  it('types contributions to its extension point', () => {
    definePlugin({
      name: 'typed',
      contributions: { 'hello-extra': { greeters: [{ word: 'Ok' }] } },
    });
    definePlugin({
      name: 'typed',
      // @ts-expect-error a greeter is `{ word }`
      contributions: { 'hello-extra': { greeters: [{ words: 'no' }] } },
    });
    expect(() =>
      resolveConfig({
        ...config(),
        plugins: [
          helloPlugin(),
          helloExtraPlugin(),
          definePlugin({
            name: 'typed',
            contributions: { 'hello-extra': { greeters: [{ word: 'two words' }] } },
          }),
        ],
      }),
    ).toThrow('typed: a greeter is one word, got "two words"');
  });

  it('refuses to start without a required plugin', () => {
    expect(() => resolveConfig({ ...config(), plugins: [helloExtraPlugin()] })).toThrow(
      expect.objectContaining({ key: 'plugin.requires.missing' }),
    );
  });
});

describe('the greeting board', () => {
  it('shows the contributed words, gated by each plugin’s flag', async () => {
    await helloRepos(api.repos).greetings.create({ spaceId }, 'Hello there');
    const board = client(rootKey).board;
    expect(await board.get({ spaceId })).toEqual({
      words: ['Hello (hello)', 'Servus (hello)', 'Hi (hello-extra)'],
      greetings: 1,
      helloOn: true,
    });

    // Hello off in the space: its words go; its services stay reachable.
    await set(`space:${spaceId}`, { 'features.plugins.hello': { enabled: false } });
    expect(await board.get({ spaceId })).toEqual({
      words: ['Hi (hello-extra)'],
      greetings: 1,
      helloOn: false,
    });
    expect(await boardOf(api).words(spaceId)).toEqual(['Hi (hello-extra)']);

    await set(`space:${spaceId}`, { 'features.plugins.hello-extra': { enabled: false } });
    const refused = await board.get({ spaceId }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ORPCError);
    // Off with a lock by default: refused with it.
    expect((refused as ORPCError<string, unknown>).code).toBe('FORBIDDEN');
  });

  it('reaches hello’s services through the plugin lookup', async () => {
    const board = boardOf(api);
    const before = await board.greetings(spaceId);
    await helloRepos(api.repos).greetings.create({ spaceId }, 'Once more');
    expect(await board.greetings(spaceId)).toBe((before ?? 0) + 1);
    expect(api.manablox.plugins.get('hello')?.greetings).toBeDefined();
    expect(api.manablox.plugins.require('hello')).toBe(api.manablox.plugins.get('hello'));
    expect(() => api.manablox.plugins.require('missing' as 'hello')).toThrow(
      'The missing plugin is not configured.',
    );
  });
});

describe('the plugin lifecycle', () => {
  it('starts with the server and stops with it', async () => {
    const other = requireManagement(await bootstrap(config()));
    const board = boardOf(other);
    expect(board.started).toBe(true);
    await other.shutdown();
    expect(board.started).toBe(false);
    expect(boardOf(api).started).toBe(true);
  });
});

const redisUrl = process.env.TEST_REDIS_URL ?? '';

describe.skipIf(!redisUrl)('the board channel', () => {
  it('tells the other processes', async () => {
    const withRedis = (): ManabloxConfig => config({ cache: { redisUrl } });
    const sender = requireManagement(await bootstrap(withRedis()));
    const receiver = requireManagement(await bootstrap(withRedis()));
    runtimes.push(sender, receiver);
    // Subscribing is asynchronous; a message before it would be missed.
    await new Promise((resolve) => setTimeout(resolve, 200));
    boardOf(sender).announce(spaceId);
    await vi.waitFor(() => expect(boardOf(receiver).heard).toContainEqual({ spaceId }));
    expect(boardOf(sender).heard).toEqual([]);
  });
});

describe('stamps in a space export', () => {
  it('import after the greetings they point at, under the ids those were restored with', async () => {
    const source = await freshSpace();
    const greeting = await helloRepos(api.repos).greetings.create({ spaceId: source }, 'Hello');
    const stamps = helloExtraRepos(api.repos).stamps;
    await stamps.create({ spaceId: source }, 'On hello', greeting.id);
    await stamps.create({ spaceId: source }, 'Loose');

    const payload = await api.spaces.export(source);
    expect(payload.sections.slice(-2)).toEqual(['hello.greetings', 'hello-extra.stamps']);
    const copy = (sections?: string[]) => {
      const id = crypto.randomUUID();
      return {
        data: { ...payload, space: { ...payload.space, id, machineName: `copy-${++seq}` } },
        id,
        sections,
      };
    };

    const whole = copy();
    // The stamps' ids stay; the other space still holds them, so the source goes first.
    await api.spaces.delete(source);
    await api.spaces.import(whole.data, ownerId);
    const [restored] = await helloRepos(api.repos).greetings.list(whole.id);
    expect(restored?.id).not.toBe(greeting.id);
    const imported = await stamps.list(whole.id);
    expect(imported.map((row) => [row.label, row.greetingId])).toEqual([
      ['On hello', restored?.id],
      ['Loose', null],
    ]);

    await api.spaces.delete(whole.id);
    const partial = copy(['hello-extra.stamps']);
    const result = await api.spaces.import(partial.data, ownerId, { sections: partial.sections });
    expect((await stamps.list(partial.id)).map((row) => row.label)).toEqual(['Loose']);
    expect(result.notes).toContain('1 stamps were left out: their greeting was not.');
  });
});
