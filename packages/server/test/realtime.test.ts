import type { Principal } from '@manablox/auth';
import type { RealtimeEvent } from '@manablox/core';
import { ids } from '@manablox/core/testing';
import { RealtimeService } from '@manablox/services';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Runtime } from '../src/bootstrap.js';
import { canHear, realtimeRoutes } from '../src/routes/realtime.js';
import { initialised, stubRuntime } from './helpers/runtime.js';

const event = (over: Partial<RealtimeEvent> = {}): RealtimeEvent => ({
  id: 'e1',
  seq: 1,
  at: '2026-01-01T00:00:00.000Z',
  spaceId: ids.space,
  action: 'content.update',
  targetKind: 'content',
  targetId: 'c1',
  targetLabel: 'Home',
  actor: { kind: 'user', id: 'u-alice', label: 'alice@example.com' },
  clientId: 'tab-1',
  ...over,
});

const editor: Principal = {
  userId: 'u-bob',
  email: 'bob@example.com',
  role: 'editor',
  spaces: { [ids.space]: 'editor' },
};
const superadmin: Principal = { ...editor, userId: 'u-root', role: 'superadmin', spaces: {} };

describe('canHear', () => {
  it('lets a member hear their space and not another', () => {
    expect(canHear(editor, event())).toBe(true);
    expect(canHear(editor, event({ spaceId: ids.otherSpace }))).toBe(false);
  });

  it('keeps instance-wide changes to superadmins, except those about the listener', () => {
    const account = event({ spaceId: null, targetKind: 'user', targetId: 'u-alice' });
    expect(canHear(editor, account)).toBe(false);
    expect(canHear(superadmin, account)).toBe(true);
    expect(canHear(editor, event({ spaceId: null, targetKind: 'user', targetId: 'u-bob' }))).toBe(
      true,
    );
    expect(canHear(editor, event({ spaceId: null, targetKind: 'apiKey', targetId: 'u-bob' }))).toBe(
      false,
    );
  });

  it('confines a space-restricted key even when its owner is a superadmin', () => {
    const restricted: Principal = { ...superadmin, allowedSpaceIds: [ids.otherSpace] };
    expect(canHear(restricted, event())).toBe(false);
    expect(canHear(restricted, event({ spaceId: null, targetKind: 'user' }))).toBe(false);
    expect(canHear(restricted, event({ spaceId: ids.otherSpace }))).toBe(true);
  });
});

/** A stub runtime whose session resolves to `principal`, or to nobody. */
async function build(principal: Principal | null) {
  const { runtime, manablox } = stubRuntime();
  const realtime = new RealtimeService(manablox);
  (runtime as { realtime: RealtimeService }).realtime = realtime;
  const auth = runtime.auth as unknown as { api: { getSession: () => Promise<unknown> } };
  auth.api.getSession = async () =>
    principal ? { user: { id: principal.userId, email: principal.email } } : null;
  (runtime.repos as unknown as { users: Record<string, unknown> }).users = {
    ...(runtime.repos.users as unknown as Record<string, unknown>),
    findPrincipal: async () =>
      principal
        ? { role: principal.role, banned: false, spaces: principal.spaces, permissions: {} }
        : null,
  };
  await initialised(runtime as Runtime);
  const app = await createApp(runtime);
  return { app, realtime };
}

/** Reads the stream until `count` lines starting with `data:` have arrived. */
/** Collects `count` data lines, calling `onReady` once the stream is subscribed. */
async function readEvents(
  response: Response,
  count: number,
  onReady: () => void,
): Promise<string[]> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('no body');
  const decoder = new TextDecoder();
  let text = '';
  let ready = false;
  const lines = () => text.split('\n').filter((line) => line.startsWith('data:'));
  while (lines().length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (!ready && text.includes('event: ready')) {
      ready = true;
      onReady();
    }
  }
  await reader.cancel();
  return lines().map((line) => line.slice('data:'.length).trim());
}

describe('GET /realtime/events', () => {
  it('refuses a caller with no session', async () => {
    const { app } = await build(null);
    const res = await app.request('http://admin.test/realtime/events');
    expect(res.status).toBe(401);
  });

  it('streams the changes the caller may see and drops the rest', async () => {
    const { app, realtime } = await build(editor);
    const controller = new AbortController();
    const res = await app.request('http://admin.test/realtime/events', {
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    // Once `ready`, publish one for the member's space and one for another.
    const data = await readEvents(res, 2, () => {
      realtime.publish(event({ id: 'other', spaceId: ids.otherSpace }));
      realtime.publish(event({ id: 'mine' }));
    });
    controller.abort();

    expect(JSON.parse(data[0] as string)).toEqual({ userId: 'u-bob' });
    expect((JSON.parse(data[1] as string) as RealtimeEvent).id).toBe('mine');
  });

  it("hands a notification to its recipient's stream and to nobody else's", async () => {
    const { app, realtime } = await build(editor);
    const controller = new AbortController();
    const res = await app.request('http://admin.test/realtime/events', {
      signal: controller.signal,
    });
    const notification = {
      id: 'n1',
      kind: 'content.approvalRequested' as const,
      title: 'Approve me',
      body: '',
      url: '/content/c1',
      spaceId: ids.space,
      at: '2026-01-01T00:00:00.000Z',
    };
    const data = await readEvents(res, 2, () => {
      realtime.publishNotification({ ...notification, userId: 'u-alice' });
      realtime.publishNotification({ ...notification, userId: 'u-bob' });
    });
    controller.abort();

    expect(JSON.parse(data[1] as string)).toMatchObject({ userId: 'u-bob', title: 'Approve me' });
  });

  it('is not mounted on a public instance', async () => {
    const { runtime } = stubRuntime({
      server: { mode: 'public' },
      publicApi: { spaceId: ids.space },
    } as never);
    await initialised(runtime);
    const app = await createApp(runtime);
    const res = await app.request('http://public.test/realtime/events');
    expect(res.status).toBe(404);
  });
});

/** The principal is re-resolved each heartbeat; the stream sends `expired` and closes when it is gone. */
describe('a stream whose session goes away', () => {
  async function buildRevocable(initial: Principal) {
    let current: Principal | null = initial;
    let failing = false;
    const { runtime, manablox } = stubRuntime();
    const realtime = new RealtimeService(manablox);
    (runtime as { realtime: RealtimeService }).realtime = realtime;
    const auth = runtime.auth as unknown as { api: { getSession: () => Promise<unknown> } };
    auth.api.getSession = async () =>
      current ? { user: { id: current.userId, email: current.email } } : null;
    (runtime.repos as unknown as { users: Record<string, unknown> }).users = {
      ...(runtime.repos.users as unknown as Record<string, unknown>),
      findPrincipal: async () => {
        if (failing) throw new Error('database unavailable');
        return current
          ? { role: current.role, banned: false, spaces: current.spaces, permissions: {} }
          : null;
      },
    };
    await initialised(runtime as Runtime);

    const app = new Hono();
    app.route('/', realtimeRoutes(runtime as Runtime, { heartbeatMs: 20 }));
    return {
      app,
      realtime,
      revoke: () => (current = null),
      fail: (on: boolean) => (failing = on),
    };
  }

  it('closes the stream once the session is gone, and says why', async () => {
    const { app, revoke } = await buildRevocable(editor);
    const controller = new AbortController();
    const res = await app.request('http://admin.test/realtime/events', {
      signal: controller.signal,
    });
    expect(res.status).toBe(200);

    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let text = '';

    // Read until the first heartbeat.
    while (!text.includes('event: ping')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    expect(text).toContain('event: ping');

    revoke();
    while (!text.includes('event: expired')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    expect(text).toContain('event: expired');
    controller.abort();
  });

  it('stops delivering a space it may no longer see', async () => {
    const { app, realtime, revoke } = await buildRevocable(editor);
    const controller = new AbortController();
    const res = await app.request('http://admin.test/realtime/events', {
      signal: controller.signal,
    });
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let text = '';
    const pump = async (until: (value: string) => boolean) => {
      while (!until(text)) {
        const { value, done } = await reader.read();
        if (done) return;
        text += decoder.decode(value, { stream: true });
      }
    };

    await pump((value) => value.includes('event: ready'));
    revoke();
    await pump((value) => value.includes('event: expired'));

    const before = text.length;
    realtime.publish(event({ id: 'after-revocation' }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(text.slice(before)).not.toContain('after-revocation');
    controller.abort();
  });

  it('keeps the stream when the session check fails', async () => {
    const { app, fail } = await buildRevocable(editor);
    const controller = new AbortController();
    const res = await app.request('http://admin.test/realtime/events', {
      signal: controller.signal,
    });
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let text = '';
    const pings = () => text.split('event: ping').length - 1;

    await reader.read().then(({ value }) => (text += decoder.decode(value, { stream: true })));
    fail(true);
    while (pings() < 3) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    expect(pings()).toBeGreaterThanOrEqual(3);
    expect(text).not.toContain('event: expired');
    controller.abort();
  });
});
