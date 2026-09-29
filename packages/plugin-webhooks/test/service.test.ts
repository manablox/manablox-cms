import { createHmac } from 'node:crypto';
import { ManabloxError, memoryRateLimitStore, RetryLater } from '@manablox/core';
import type { Repositories } from '@manablox/db';
import { CredentialService } from '@manablox/services';
import {
  createServiceContext,
  type ServiceContext,
  withControls,
} from '@manablox/services/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { webhookRepos } from '../src/server/db/index.js';
import { webhooksPlugin } from '../src/server/plugin.js';
import { validateWebhookInput } from '../src/server/services/webhook/validate.js';
import {
  type IncomingWebhookListener,
  type WebhookDelivery,
  WebhookService,
  type WebhookServiceOptions,
} from '../src/server/services/webhook.service.js';

let ctx: ServiceContext;
let repos: Repositories;
let content: ServiceContext['content'];
let credentials: CredentialService;
let service: WebhookService;
let spaceId: string;
let pageType: string;
let otherSpace: string;

const queued: WebhookDelivery[] = [];
const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
let status = 200;
/** What the listener claims to have started and aborted, so a call's answer can be checked. */
let started: string[] = [];
let aborted: string[] = [];
const seen: Array<{ slug: string; body: unknown }> = [];
/** Listeners per endpoint id, as the listener counts them. */
const listeners = new Map<string, number>();

/** A stand-in for what acts on incoming calls, such as the webhooks plugin's workflows. */
const listener: IncomingWebhookListener = {
  received: async (webhook, payload) => {
    seen.push({ slug: webhook.slug, body: payload.body });
    return { runIds: started, abortedRunIds: aborted };
  },
  counts: async () => new Map(listeners),
};
/** The service's options: a queue into `queued`, a fetch into `calls`. */
let options: WebhookServiceOptions;

beforeAll(async () => {
  ctx = await createServiceContext('webhooks', {
    fieldTypes: [],
    contentTypes: [{ name: 'page', fields: [] }],
    config: { plugins: [webhooksPlugin()] },
  });
  ({ repos, content, spaceId } = ctx);
  pageType = ctx.ids.page as string;
  credentials = new CredentialService(ctx.manablox, repos);
  options = {
    enqueue: async (deliveries) => {
      queued.push(...deliveries);
    },
    credentials,
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        headers: init?.headers as Record<string, string>,
        body: String(init?.body),
      });
      return new Response('', { status });
    }) as typeof fetch,
  };
  service = new WebhookService(ctx.manablox, repos, { ...options, listener });
  // The plugin's content hooks dispatch through the services the instance holds.
  ctx.manablox.providePlugin('webhooks', { services: { webhooks: service } });
  otherSpace = (await repos.spaces.create({ name: 'O', machineName: 'o', url: 'http://o.test' }))
    .id;
});

afterAll(async () => {
  await ctx?.close();
});

beforeEach(() => {
  queued.length = 0;
  calls.length = 0;
  seen.length = 0;
  listeners.clear();
  started = [];
  aborted = [];
  status = 200;
  ctx.controlStore.rates = memoryRateLimitStore();
});

const pageIn = (space: string, title: string) =>
  content.create({
    spaceId: space,
    typeId: pageType,
    locale: 'en',
    title,
    slug: title.toLowerCase().replace(/\s+/g, '-'),
    fields: {},
  });

describe('outgoing webhooks', () => {
  it('queues a delivery per listening webhook when content changes', async () => {
    const all = await service.create(spaceId, {
      direction: 'outgoing',
      name: 'All',
      url: 'https://all.test',
      events: [],
    });
    await service.create(spaceId, {
      direction: 'outgoing',
      name: 'Deletes',
      url: 'https://del.test',
      events: ['content.deleted'],
    });
    await service.create(spaceId, {
      direction: 'outgoing',
      name: 'Off',
      url: 'https://off.test',
      events: [],
      enabled: false,
    });

    const row = await content.create({
      spaceId,
      typeId: pageType,
      locale: 'en',
      title: 'Hook',
      slug: 'hook',
      fields: {},
    });

    queued.length = 0;
    await content.publish(spaceId, row.id);
    expect(queued.map((delivery) => delivery.event)).toEqual(['content.published']);
    expect(queued[0]?.webhookId).toBe(all.id);
    expect(queued[0]?.payload).toMatchObject({ id: row.id, permalink: 'hook' });

    queued.length = 0;
    await content.delete(spaceId, row.id);
    // The catch-all hears it, and so does the one that asked only for deletions.
    expect(queued.map((delivery) => delivery.event)).toEqual([
      'content.deleted',
      'content.deleted',
    ]);
  });

  it('sees an endpoint switched on or off at once, though it keeps the enabled list', async () => {
    const row = await content.create({
      spaceId,
      typeId: pageType,
      locale: 'en',
      title: 'Toggle',
      slug: 'toggle',
      fields: {},
    });
    const hook = await service.create(spaceId, {
      direction: 'outgoing',
      name: 'Toggled',
      url: 'https://toggled.test',
      events: ['content.updated'],
    });
    const touch = async () => {
      queued.length = 0;
      await content.update(spaceId, row.id, {
        spaceId,
        typeId: pageType,
        locale: 'en',
        slug: 'toggle',
        title: `Toggle ${Date.now()}`,
        fields: {},
      });
      return queued.filter((delivery) => delivery.webhookId === hook.id).length;
    };
    expect(await touch()).toBe(1);
    await service.setEnabled(spaceId, hook.id, false);
    expect(await touch()).toBe(0);
    await service.setEnabled(spaceId, hook.id, true);
    expect(await touch()).toBe(1);
    await service.delete(spaceId, hook.id);
    expect(await touch()).toBe(0);
  });

  it('signs with the vault credential, logs the call, and throws so the queue retries', async () => {
    const credential = await credentials.create(spaceId, {
      name: 'Deploy secret',
      kind: 'signing',
      data: { secret: 'shhh' },
    });
    const hook = await service.create(spaceId, {
      direction: 'outgoing',
      name: 'Signed',
      url: 'https://signed.test',
      events: ['content.published'],
      auth: { mode: 'hmac', credentialId: credential.id },
    });

    const delivery: WebhookDelivery = {
      webhookId: hook.id,
      event: 'content.published',
      payload: { id: 'abc' },
    };
    await service.deliver(delivery);

    const call = calls.at(-1);
    expect(call?.url).toBe('https://signed.test');
    expect(call?.headers['x-manablox-event']).toBe('content.published');
    const expected = `sha256=${createHmac('sha256', 'shhh')
      .update(call?.body ?? '')
      .digest('hex')}`;
    expect(call?.headers['x-manablox-signature']).toBe(expected);

    status = 503;
    await expect(service.deliver(delivery)).rejects.toThrow('HTTP 503');
    const { items: log } = await service.deliveries(spaceId, hook.id);
    // Newest first: the failure, then the one that worked.
    expect(log.map((entry) => entry.status)).toEqual([503, 200]);
  });

  it('refuses a webhook whose credential is the wrong kind for its mode', async () => {
    const bearer = await credentials.create(spaceId, {
      name: 'A token',
      kind: 'bearer',
      data: { token: 't' },
    });
    await expect(
      service.create(spaceId, {
        direction: 'outgoing',
        name: 'Wrong',
        url: 'https://wrong.test',
        auth: { mode: 'hmac', credentialId: bearer.id },
      }),
    ).rejects.toMatchObject({ key: 'plugins.webhooks.validation.failed' });
  });
});

describe('incoming webhooks', () => {
  it('lets a correctly signed call through and hands it to the listener', async () => {
    const credential = await credentials.create(spaceId, {
      name: 'Inbound secret',
      kind: 'signing',
      data: { secret: 'inbound' },
    });
    const hook = await service.create(spaceId, {
      direction: 'incoming',
      name: 'From the shop',
      auth: { mode: 'hmac', credentialId: credential.id },
    });
    expect(hook.endpoint).toMatch(/\/plugins\/webhooks\/in\/[0-9a-f-]+\/from-the-shop$/);

    const raw = JSON.stringify({ action: 'opened', number: 7 });
    started = ['run-1', 'run-2'];
    aborted = ['run-0'];
    const result = await service.receive(spaceId, hook.slug, {
      method: 'POST',
      raw,
      headers: {
        'content-type': 'application/json',
        'x-manablox-signature': `sha256=${createHmac('sha256', 'inbound').update(raw).digest('hex')}`,
      },
      query: {},
    });

    expect(result.runIds).toEqual(['run-1', 'run-2']);
    expect(result.abortedRunIds).toEqual(['run-0']);
    expect(seen).toEqual([{ slug: hook.slug, body: { action: 'opened', number: 7 } }]);
    const { items: log } = await service.deliveries(spaceId, hook.id);
    expect(log[0]).toMatchObject({ status: 202, error: null, runIds: ['run-1', 'run-2'] });
    // The signature itself is not worth keeping, but the rest of the call is.
    expect(log[0]?.headers['content-type']).toBe('application/json');
  });

  it('shows the listeners the listener counts, and without one only verifies and logs', async () => {
    const hook = await service.create(spaceId, { direction: 'incoming', name: 'Counted' });
    listeners.set(hook.id, 3);
    expect((await service.get(spaceId, hook.id)).listeners).toBe(3);

    const bare = new WebhookService(ctx.manablox, repos, options);
    expect((await bare.get(spaceId, hook.id)).listeners).toBe(0);
    started = ['never'];
    const result = await bare.receive(spaceId, hook.slug, {
      method: 'POST',
      raw: '{}',
      headers: {},
      query: {},
    });
    expect(result).toMatchObject({ runIds: [], abortedRunIds: [] });
    expect(seen).toEqual([]);
    const { items: log } = await service.deliveries(spaceId, hook.id);
    expect(log[0]).toMatchObject({ status: 202, runIds: [] });
  });

  it('fires webhooks:received for a verified call, before the listener; a throwing handler is logged', async () => {
    const hook = await service.create(spaceId, { direction: 'incoming', name: 'Observed' });
    const order: string[] = [];
    const received: unknown[] = [];
    const offs = [
      ctx.manablox.hooks.on('webhooks:received', (call, context) => {
        order.push('hook');
        received.push({ ...call, spaceId: context.spaceId });
      }),
      ctx.manablox.hooks.on('webhooks:received', () => {
        throw new Error('observer broke');
      }),
    ];
    const bare = new WebhookService(ctx.manablox, repos, {
      ...options,
      listener: {
        received: async () => {
          order.push('listener');
          return { runIds: [], abortedRunIds: [] };
        },
        counts: async () => new Map(),
      },
    });
    try {
      const result = await bare.receive(spaceId, hook.slug, {
        method: 'POST',
        raw: '{"order":1}',
        headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
        query: { q: '1' },
      });
      expect(result.deliveryId).toBeTruthy();
    } finally {
      for (const off of offs) off();
    }
    expect(order).toEqual(['hook', 'listener']);
    expect(received).toEqual([
      {
        webhook: expect.objectContaining({ id: hook.id, slug: hook.slug, spaceId }),
        payload: { body: { order: 1 }, query: { q: '1' }, method: 'POST' },
        // Secret-bearing headers stay out.
        headers: { 'content-type': 'application/json' },
        spaceId,
      },
    ]);
  });

  it('rejects a wrong signature, logs the attempt, and starts nothing', async () => {
    const credential = await credentials.create(spaceId, {
      name: 'Guarded secret',
      kind: 'signing',
      data: { secret: 'right' },
    });
    const hook = await service.create(spaceId, {
      direction: 'incoming',
      name: 'Guarded',
      auth: { mode: 'hmac', credentialId: credential.id },
    });

    await expect(
      service.receive(spaceId, hook.slug, {
        method: 'POST',
        raw: '{}',
        headers: { 'x-manablox-signature': 'sha256=nonsense' },
        query: {},
      }),
    ).rejects.toMatchObject({ key: 'plugins.webhooks.unauthorized' });

    expect(seen).toEqual([]);
    const { items: log } = await service.deliveries(spaceId, hook.id);
    expect(log[0]).toMatchObject({ status: 401, error: 'plugins.webhooks.unauthorized' });
  });

  it('refuses a method the endpoint does not accept, and a call to a switched-off one', async () => {
    const hook = await service.create(spaceId, {
      direction: 'incoming',
      name: 'Post only',
      methods: ['POST'],
    });
    await expect(
      service.receive(spaceId, hook.slug, {
        method: 'GET',
        raw: '',
        headers: {},
        query: {},
      }),
    ).rejects.toMatchObject({ key: 'plugins.webhooks.methodNotAllowed' });

    await service.setEnabled(spaceId, hook.id, false);
    await expect(
      service.receive(spaceId, hook.slug, { method: 'POST', raw: '{}', headers: {}, query: {} }),
    ).rejects.toMatchObject({ key: 'plugins.webhooks.disabled' });
  });

  it('accepts a token in the header the credential names', async () => {
    const credential = await credentials.create(spaceId, {
      name: 'Shared key',
      kind: 'apiKey',
      data: { header: 'X-Shop-Key', key: 'sekrit' },
    });
    const hook = await service.create(spaceId, {
      direction: 'incoming',
      name: 'Keyed',
      auth: { mode: 'token', credentialId: credential.id },
    });

    await expect(
      service.receive(spaceId, hook.slug, {
        method: 'POST',
        raw: '{}',
        headers: { 'x-shop-key': 'wrong' },
        query: {},
      }),
    ).rejects.toMatchObject({ key: 'plugins.webhooks.unauthorized' });

    const result = await service.receive(spaceId, hook.slug, {
      method: 'POST',
      raw: '{}',
      headers: { 'x-shop-key': 'sekrit' },
      query: {},
    });
    expect(result.webhook.slug).toBe(hook.slug);
  });

  it('gives two endpoints of a space distinct slugs', async () => {
    const first = await service.create(spaceId, { direction: 'incoming', name: 'Same name' });
    const second = await service.create(spaceId, { direction: 'incoming', name: 'Same name' });
    expect(first.slug).toBe('same-name');
    expect(second.slug).toBe('same-name-2');
  });
});

/** The guard on code-declared endpoints, and the form validation. */
describe('a code-declared endpoint', () => {
  it('refuses an edit, a delete and a switch from the admin', async () => {
    const row = await webhookRepos(repos).create({
      spaceId,
      name: 'Declared',
      slug: 'declared',
      url: 'https://example.test/hook',
      events: ['content.published'],
      source: 'code',
      sourceRef: 'manablox.config.ts',
    });

    const input = {
      direction: 'outgoing' as const,
      name: 'Renamed',
      url: 'https://example.test/other',
      events: ['content.published'],
    };
    await expect(service.update(spaceId, row.id, input)).rejects.toMatchObject({
      key: 'plugins.webhooks.code.immutable',
    });
    await expect(service.delete(spaceId, row.id)).rejects.toMatchObject({
      key: 'plugins.webhooks.code.immutable',
    });
    // The on/off switch stays editable so a declaration can be disabled without a deploy.
    await expect(service.setEnabled(spaceId, row.id, false)).resolves.toMatchObject({
      enabled: false,
    });
  });
});

describe('validating an endpoint', () => {
  const base = { direction: 'outgoing' as const, name: 'Deploy', events: ['content.published'] };

  it('collects every problem rather than stopping at the first', async () => {
    const failure = await validateWebhookInput(
      repos,
      spaceId,
      { ...base, name: '  ', url: 'not-a-url', events: ['nope'] },
      null,
    ).catch((error: unknown) => error);

    expect(ManabloxError.is(failure)).toBe(true);
    const keys = (failure as ManabloxError).details.map((detail) => detail.key);
    expect(keys).toContain('plugins.webhooks.name.required');
    expect(keys).toContain('plugins.webhooks.url.invalid');
    expect(keys).toContain('plugins.webhooks.event.unknown');
  });

  it('requires an address on the way out and none on the way in', async () => {
    await expect(
      validateWebhookInput(repos, spaceId, { ...base, url: '' }, null),
    ).rejects.toMatchObject({ key: 'plugins.webhooks.validation.failed' });

    const incoming = await validateWebhookInput(
      repos,
      spaceId,
      { direction: 'incoming', name: 'Receive' },
      null,
    );
    expect(incoming.url).toBe('');
    // An incoming endpoint accepts POST unless it says otherwise.
    expect(incoming.methods).toEqual(['POST']);
  });

  it('refuses a header name a header cannot have', async () => {
    await expect(
      validateWebhookInput(
        repos,
        spaceId,
        { ...base, url: 'https://example.test/h', headers: [{ name: 'bad header', value: 'x' }] },
        null,
      ),
    ).rejects.toMatchObject({ key: 'plugins.webhooks.validation.failed' });
  });

  it('derives a slug from the name and keeps it unique within a direction', async () => {
    const first = await validateWebhookInput(
      repos,
      spaceId,
      { ...base, name: 'Slug Source', url: 'https://example.test/a' },
      null,
    );
    expect(first.slug).toBe('slug-source');

    await webhookRepos(repos).create({
      spaceId,
      name: 'Slug Source',
      slug: 'slug-source',
      url: 'https://example.test/a',
      events: [],
    });
    const second = await validateWebhookInput(
      repos,
      spaceId,
      { ...base, name: 'Slug Source', url: 'https://example.test/b' },
      null,
    );
    expect(second.slug).toBe('slug-source-2');
  });
});

describe('webhooks:beforeCreate', () => {
  it('refuses a new webhook', async () => {
    const seenPayloads: unknown[] = [];
    const off = ctx.manablox.hooks.on('webhooks:beforeCreate', (payload) => {
      seenPayloads.push(payload);
      throw ManabloxError.forbidden('auth.forbidden');
    });
    try {
      await expect(
        service.create(otherSpace, { direction: 'incoming', name: 'Refused' }),
      ).rejects.toMatchObject({ key: 'auth.forbidden' });
    } finally {
      off();
    }
    expect(seenPayloads).toEqual([{ spaceId: otherSpace, direction: 'incoming', name: 'Refused' }]);
    expect(await webhookRepos(repos).listBySpace(otherSpace)).toEqual([]);
  });
});

describe('webhooks flag', () => {
  const refused = (promise: Promise<unknown>) =>
    expect(promise).rejects.toMatchObject({ key: 'control.feature', status: 403 });

  it('refuses writes, drops deliveries and answers incoming calls with not found', async () => {
    const outgoing = await service.create(spaceId, {
      direction: 'outgoing',
      name: 'Out',
      url: 'https://out.test',
      events: [],
    });
    const incoming = await service.create(spaceId, {
      direction: 'incoming',
      name: 'In',
      auth: { mode: 'none' },
    });
    const restore = await withControls(ctx, {
      scope: { kind: 'space', id: spaceId },
      features: { 'plugins.webhooks': false },
    });
    try {
      await refused(
        service.create(spaceId, {
          direction: 'outgoing',
          name: 'Another',
          url: 'https://another.test',
          events: [],
        }),
      );
      await refused(service.setEnabled(spaceId, outgoing.id, false));
      await refused(service.test(spaceId, outgoing.id));

      queued.length = 0;
      await pageIn(spaceId, 'No hooks');
      expect(queued).toHaveLength(0);
      await service.deliver({ webhookId: outgoing.id, event: 'content.created', payload: {} });
      expect(calls).toHaveLength(0);

      await expect(
        service.receive(spaceId, incoming.slug, {
          method: 'POST',
          raw: '{}',
          headers: {},
          query: {},
        }),
      ).rejects.toMatchObject({ key: 'plugins.webhooks.notFound', status: 404 });
      expect(seen).toEqual([]);

      // Reads stay open.
      expect((await service.get(spaceId, outgoing.id)).name).toBe('Out');
    } finally {
      await restore();
    }

    await pageIn(spaceId, 'Hooks again');
    expect(queued.length).toBeGreaterThan(0);
  });
});

describe('count limits', () => {
  it('counts webhooks at create', async () => {
    const restore = await withControls(ctx, {
      scope: { kind: 'space', id: otherSpace },
      values: { 'limits.plugins.webhooks.count': { max: 1, mode: 'hard' } },
    });
    try {
      const used = (await webhookRepos(repos).listBySpace(otherSpace)).length;
      if (used === 0) {
        await service.create(otherSpace, { direction: 'incoming', name: 'First' });
      }
      await expect(
        service.create(otherSpace, { direction: 'incoming', name: 'Second' }),
      ).rejects.toMatchObject({
        key: 'control.limit',
        status: 409,
        details: [{ params: { limit: 'plugins.webhooks.count' } }],
      });
    } finally {
      await restore();
    }
  });
});

describe('plugins.webhooks.outgoing', () => {
  it('delays a delivery past the budget instead of dropping it', async () => {
    const restore = await withControls(ctx, {
      scope: { kind: 'space', id: spaceId },
      values: { 'rateLimits.plugins.webhooks.outgoing': { max: 1, windowSeconds: 60 } },
    });
    try {
      const hook = await service.create(spaceId, {
        direction: 'outgoing',
        name: 'Budgeted',
        url: 'https://hooks.test/out',
        events: ['content.published'],
      });
      const delivery = { webhookId: hook.id, event: 'content.published', payload: { id: 'x' } };
      await service.deliver(delivery);
      expect(calls).toHaveLength(1);
      const later = await service.deliver(delivery).then(
        () => null,
        (error: unknown) => error,
      );
      expect(RetryLater.is(later)).toBe(true);
      expect((later as RetryLater).delay).toBeGreaterThan(0);
      expect(calls).toHaveLength(1);
    } finally {
      await restore();
    }
  });
});
