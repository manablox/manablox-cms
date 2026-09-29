import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { bootstrap, type ManagementRuntime, requireManagement } from '../src/bootstrap.js';

const KEY = 'control-events-key-0123456789';
const SECRET = 'control-events-webhook-secret';

interface Pushed {
  seq: number;
  type: string;
  scope: string;
  payload: Record<string, any>;
}

let db: TestDatabase;
let dir: string;
let runtime: ManagementRuntime;
let app: Hono;
let server: Server;
let webhookUrl: string;
const pushed: Pushed[] = [];
const badSignatures: string[] = [];

const config = (overrides: Record<string, unknown> = {}) => ({
  database: { url: db.url },
  auth: { secret: 'control-events-secret' },
  fieldTypes: builtinFieldTypes,
  logLevel: 'silent',
  storage: { driver: 'local' as const, local: { path: join(dir, 'files') } },
  server: { rateLimit: false, scopes: ['rpc', 'auth', 'control'] },
  control: { apiKey: KEY, webhookUrl, webhookSecret: SECRET },
  ...overrides,
});

const control = (path: string, init: { method?: string; body?: unknown } = {}) =>
  app.request(`/control/v1${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${KEY}`,
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

const json = async (response: Response) => (await response.json()) as Record<string, any>;
const runtimeSeq = () => runtime.repos.controlEvents.latestSeq();

async function eventually<T>(read: () => T | Promise<T>, done: (value: T) => boolean): Promise<T> {
  const until = Date.now() + 8000;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > until) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Checks `X-Manablox-Signature` the way a receiver would. */
function verify(header: string, body: string): boolean {
  const parts = Object.fromEntries(header.split(',').map((part) => part.split('=')));
  const expected = createHmac('sha256', SECRET).update(`${parts.t}.${body}`).digest('hex');
  return parts.v1 === expected && Math.abs(Date.now() / 1000 - Number(parts.t)) < 300;
}

beforeAll(async () => {
  db = await createTestDatabase('server_control_events');
  dir = await mkdtemp(join(tmpdir(), 'manablox-control-events-'));
  server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      const signature = String(request.headers['x-manablox-signature'] ?? '');
      if (!verify(signature, body)) {
        badSignatures.push(signature);
        response.statusCode = 401;
      } else {
        pushed.push(...(JSON.parse(body) as { events: Pushed[] }).events);
        response.statusCode = 204;
      }
      response.end();
    });
  });
  // Loopback: reachable only through the allowlist entry for the webhook's host.
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  webhookUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/events`;
  runtime = requireManagement(await bootstrap(config() as never));
  app = await createApp(runtime);
});

afterAll(async () => {
  await runtime?.shutdown();
  await new Promise((resolve) => server?.close(resolve));
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('startup', () => {
  it('refuses a webhook URL without a secret, or one that is not http', async () => {
    await expect(
      bootstrap(config({ control: { apiKey: KEY, webhookUrl: 'https://hooks.test/in' } }) as never),
    ).rejects.toMatchObject({
      key: 'config.invalid',
      details: [expect.objectContaining({ key: 'config.control.webhookSecretMissing' })],
    });
    await expect(
      bootstrap(
        config({
          control: { apiKey: KEY, webhookUrl: 'ftp://hooks.test/in', webhookSecret: SECRET },
        }) as never,
      ),
    ).rejects.toMatchObject({
      key: 'config.invalid',
      details: [expect.objectContaining({ key: 'config.control.webhookUrlInvalid' })],
    });
  });
});

describe('events through the control API', () => {
  let ownerId: string;
  let spaceId: string;

  it('pushes signed events for the owner, a provisioned space and the instance state', async () => {
    const owner = await json(
      await control('/users/owner', {
        method: 'POST',
        body: { email: 'owner@example.test', name: 'Owner' },
      }),
    );
    ownerId = owner.user.id;
    const space = await control('/spaces', {
      method: 'POST',
      body: { name: 'Shop', machineName: 'shop' },
    });
    expect(space.status).toBe(201);
    spaceId = (await json(space)).id;
    const state = await control('/instance/state', {
      method: 'PUT',
      body: { status: 'readOnly', message: 'Moving' },
    });
    expect(state.status).toBe(200);

    const events = await eventually(
      () => pushed,
      (list) => list.some((event) => event.type === 'instance.stateChanged'),
    );
    expect(badSignatures).toEqual([]);
    expect(events.map((event) => [event.type, event.scope])).toEqual([
      ['user.created', 'instance'],
      ['space.created', `space:${spaceId}`],
      ['seat.changed', `space:${spaceId}`],
      ['instance.stateChanged', 'instance'],
    ]);
    expect(events[0]?.payload).toEqual({
      userId: ownerId,
      email: 'owner@example.test',
      role: 'superadmin',
    });
    expect(events[2]?.payload).toEqual({
      spaceId,
      change: 'added',
      userIds: [ownerId],
      members: 1,
    });
    expect(events[3]?.payload).toEqual({
      from: null,
      to: { status: 'readOnly', message: 'Moving' },
    });
    const seqs = events.map((event) => event.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });

  it('pages the same events for pull, with the push acknowledged', async () => {
    // The receiver has the events before the pusher marks them delivered.
    const undelivered = await eventually(
      () => runtime.repos.controlEvents.listUndelivered(10),
      (rows) => rows.length === 0,
    );
    expect(undelivered).toEqual([]);
    const first = await json(await control('/events?limit=2'));
    expect(first.items.map((item: Pushed) => item.type)).toEqual(['user.created', 'space.created']);
    expect(first.next).toBe(first.items[1].seq);
    expect(first.items[0]).toMatchObject({
      scope: 'instance',
      payload: { userId: ownerId },
      deliveredAt: expect.any(String),
    });

    const rest = await json(await control(`/events?after=${first.next}`));
    expect(rest.items.map((item: Pushed) => item.type)).toEqual([
      'seat.changed',
      'instance.stateChanged',
    ]);
    const end = await json(await control(`/events?after=${rest.next}`));
    expect(end).toEqual({ items: [], next: rest.next });

    expect((await control('/events?limit=1001')).status).toBe(422);
    expect((await control('/events?after=-1')).status).toBe(422);
  });

  it('records accounts an admin creates and deletes, with the seats they held', async () => {
    const start = runtimeSeq();
    const editor = await runtime.users.create({
      name: 'Ed',
      email: 'ed@example.test',
      password: 'x'.repeat(12),
      role: 'editor',
    });
    await runtime.spaces.grant(spaceId, editor.id, 'editor');
    await runtime.users.delete(ownerId, editor.id);

    const rows = await runtime.repos.controlEvents.listAfter(await start, 100);
    expect(rows.map((row) => [row.type, row.payload])).toEqual([
      ['user.created', { userId: editor.id, email: 'ed@example.test', role: 'editor' }],
      ['seat.changed', { spaceId, change: 'added', userIds: [editor.id], members: 2 }],
      ['user.deleted', { userId: editor.id, email: 'ed@example.test' }],
      ['seat.changed', { spaceId, change: 'removed', userIds: [editor.id], members: 1 }],
    ]);
  });

  it('lists the events route in the OpenAPI document', async () => {
    const document = await json(
      await app.request('/control/openapi.json', { headers: { authorization: `Bearer ${KEY}` } }),
    );
    expect(Object.keys(document.paths)).toContain('/events');
  });
});
