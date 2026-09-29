import { createHmac } from 'node:crypto';
import type { Scope } from '@manablox/core';
import { workflowsPlugin } from '@manablox/plugin-workflows';
import { withControls } from '@manablox/services/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { webhookRepos } from '../src/server/db/index.js';
import { bootWebhookServer, type WebhookServer } from './helpers/server.js';

const json = async (response: Response) => (await response.json()) as Record<string, any>;

/** A published, switched-on workflow with one `transform.json` step after the trigger. */
const shapeGraph = {
  nodes: [
    {
      id: 'n1',
      key: 'shape',
      name: '',
      enabled: true,
      continueOnError: false,
      join: 'any',
      ui: { x: 0, y: 0 },
      kind: 'action',
      action: 'transform.json',
      config: { template: '{}' },
      credentialId: null,
    },
  ],
  edges: [{ id: 'e1', from: 'trigger', fromPort: 'out', to: 'n1', guard: null }],
} as never;

describe('with the workflows plugin', () => {
  let server: WebhookServer;
  let spaceId: string;
  /** API keys by who holds them. */
  const keys = { owner: '', editor: '', viewer: '' };

  /** A procedure at `plugins.webhooks`, as `holder`. */
  async function rpc(holder: keyof typeof keys, procedure: string, input: unknown) {
    const response = await server.app.request(`/rpc/plugins/webhooks/${procedure}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': keys[holder] },
      body: JSON.stringify({ json: input }),
    });
    const payload = (await response.json()) as { json: Record<string, any> };
    return { status: response.status, body: payload.json };
  }

  /** An incoming endpoint without auth, switched on. */
  const inbox = (slug: string, scope: Scope = spaceId) =>
    server.services().webhooks.create(scope, {
      direction: 'incoming',
      name: slug,
      slug,
      methods: ['POST'],
      auth: { mode: 'none' },
      enabled: true,
    });

  beforeAll(async () => {
    server = await bootWebhookServer('webhooks_server', { plugins: [workflowsPlugin()] });
    spaceId = await server.space();
    const owner = await server.api.repos.users.create({
      name: 'Owner',
      email: 'owner@hooks.test',
      role: 'superadmin',
      passwordHash: 'x',
    });
    keys.owner = (await server.api.apiKeys.issue(owner.id, 'owner')).key;
    for (const role of ['editor', 'viewer'] as const) {
      const user = await server.api.repos.users.create({
        name: role,
        email: `${role}@hooks.test`,
        role: 'editor',
        passwordHash: 'x',
      });
      await server.api.repos.users.grant(user.id, spaceId, role);
      keys[role] = (await server.api.apiKeys.issue(user.id, role)).key;
    }
  }, 60_000);

  afterAll(async () => {
    await server?.close();
  });

  describe('plugins.webhooks procedures', () => {
    it('need webhooks:read to list, which an editor holds and a viewer lacks', async () => {
      await inbox('listed');
      const listed = await rpc('editor', 'list', { spaceId, direction: 'incoming' });
      expect(listed.status).toBe(200);
      expect(listed.body.items.map((hook: { slug: string }) => hook.slug)).toContain('listed');
      expect((await rpc('viewer', 'list', { spaceId })).status).toBe(403);
      const tooMany = await rpc('owner', 'list', { spaceId, pagination: { limit: 201 } });
      expect(tooMany.body.code).toBe('BAD_REQUEST');
    });

    it('need webhooks:write to create; the answer names the new incoming URL', async () => {
      const input = { spaceId, direction: 'incoming', name: 'From the shop', slug: 'shop' };
      expect((await rpc('editor', 'create', input)).status).toBe(403);
      const created = await rpc('owner', 'create', input);
      expect(created.status).toBe(200);
      expect(created.body.endpoint).toBe(
        `https://api.hooks.test/plugins/webhooks/in/${spaceId}/shop`,
      );
    });
  });

  describe('the incoming route', () => {
    it('answers at /plugins/webhooks/in with 202 and logs the call', async () => {
      const hook = await inbox('orders');
      const response = await server.call(`/plugins/webhooks/in/${spaceId}/orders`, {
        body: '{"id":7}',
      });
      expect(response.status).toBe(202);
      expect(await json(response)).toMatchObject({ ok: true, runs: 0, aborted: 0 });
      const { items } = await server.services().webhooks.deliveries(spaceId, hook.id);
      expect(items[0]).toMatchObject({ status: 202, payload: { body: { id: 7 } } });
    });

    it("answers a staging endpoint at its environment's address only", async () => {
      const environment = await server.api.repos.environments.create({
        spaceId,
        machineName: 'staging',
        name: 'Staging',
        kind: 'staging',
      });
      const staging = { spaceId, environmentId: environment.id };
      const hook = await inbox('staged', staging);
      expect(hook.endpoint).toBe(
        `https://api.hooks.test/plugins/webhooks/in/${spaceId}/staging/staged`,
      );
      expect((await server.call(`/plugins/webhooks/in/${spaceId}/staging/staged`)).status).toBe(
        202,
      );
      expect((await server.call(`/plugins/webhooks/in/${spaceId}/staged`)).status).toBe(404);
    });

    it('answers unknown spaces, environments and slugs with not found', async () => {
      for (const path of [
        `/plugins/webhooks/in/${spaceId}/nope`,
        `/plugins/webhooks/in/${spaceId}/nowhere/orders`,
        '/plugins/webhooks/in/00000000-0000-4000-8000-000000000000/orders',
        '/plugins/webhooks/in/not-a-space/orders',
      ]) {
        const response = await server.call(path);
        expect(response.status, path).toBe(404);
      }
    });

    it('checks the signature of an HMAC endpoint over the raw body', async () => {
      const credential = await server.api.credentials.create(spaceId, {
        name: 'Shop secret',
        kind: 'signing',
        data: { secret: 'shh' },
      });
      await server.services().webhooks.create(spaceId, {
        direction: 'incoming',
        name: 'Signed',
        slug: 'signed',
        auth: { mode: 'hmac', credentialId: credential.id },
        enabled: true,
      });
      const body = '{"action":"paid"}';
      const signature = `sha256=${createHmac('sha256', 'shh').update(body).digest('hex')}`;
      const path = `/plugins/webhooks/in/${spaceId}/signed`;
      const signed = await server.call(path, {
        body,
        headers: { 'x-manablox-signature': signature },
      });
      expect(signed.status).toBe(202);
      const forged = await server.call(path, {
        body,
        headers: { 'x-manablox-signature': 'sha256=00' },
      });
      expect(forged.status).toBe(401);
      expect((await json(forged)).error).toMatchObject({ key: 'plugins.webhooks.unauthorized' });
    });

    it('answers 404 while the plugin is off in the space', async () => {
      await inbox('switched');
      const restore = await withControls(server.api, {
        scope: { kind: 'space', id: spaceId },
        features: { 'plugins.webhooks': false },
      });
      server.api.controlStore.forget(null);
      try {
        expect((await server.call(`/plugins/webhooks/in/${spaceId}/switched`)).status).toBe(404);
      } finally {
        await restore();
        server.api.controlStore.forget(null);
      }
      expect((await server.call(`/plugins/webhooks/in/${spaceId}/switched`)).status).toBe(202);
    });

    it("limits calls per IP with the space's rule of rateLimits.plugins.webhooks.incoming", async () => {
      await inbox('limited');
      const restore = await withControls(server.api, {
        scope: { kind: 'space', id: spaceId },
        values: { 'rateLimits.plugins.webhooks.incoming': { max: 1, windowSeconds: 60 } },
      });
      server.api.controlStore.forget(null);
      try {
        const path = `/plugins/webhooks/in/${spaceId}/limited`;
        expect((await server.call(path, { ip: '203.0.113.5' })).status).toBe(202);
        const refused = await server.call(path, { ip: '203.0.113.5' });
        expect(refused.status).toBe(429);
        expect((await json(refused)).error).toMatchObject({ key: 'rateLimit.exceeded' });
        expect(refused.headers.get('ratelimit-limit')).toBe('1');
        // Another caller has a budget of its own.
        expect((await server.call(path, { ip: '203.0.113.6' })).status).toBe(202);
      } finally {
        await restore();
        server.api.controlStore.forget(null);
      }
    });

    it('refuses calls with 423 on a read-only instance', async () => {
      await inbox('frozen');
      const restore = await withControls(server.api, {
        values: { state: { status: 'readOnly' } },
      });
      server.api.controlStore.forget(null);
      try {
        const refused = await server.call(`/plugins/webhooks/in/${spaceId}/frozen`);
        expect(refused.status).toBe(423);
        expect((await json(refused)).error).toMatchObject({ key: 'control.readOnly' });
      } finally {
        await restore();
        server.api.controlStore.forget(null);
      }
    });

    it('starts the workflows waiting on the endpoint and aborts their runs', async () => {
      const hook = await inbox('start');
      const stop = await inbox('stop');
      const workflows = server.api.manablox.plugins.require('workflows').workflows;
      const workflow = await workflows.create(
        spaceId,
        {
          name: 'On call',
          enabled: true,
          trigger: { kind: 'webhook', webhookId: hook.id, filter: null },
          abortTriggers: [
            { id: 'a1', kind: 'webhook', webhookId: stop.id, filter: null, match: { mode: 'all' } },
          ],
          ...(shapeGraph as object),
        } as never,
        { publish: true },
      );
      expect((await server.services().webhooks.get(spaceId, hook.id)).listeners).toBe(1);

      const started = await server.call(`/plugins/webhooks/in/${spaceId}/start`, {
        body: '{"order":1}',
      });
      expect(await json(started)).toMatchObject({ ok: true, runs: 1 });
      const { items } = await server.services().webhooks.deliveries(spaceId, hook.id);
      expect(items[0]?.runIds).toHaveLength(1);
      const history = await workflows.runHistory(
        spaceId,
        workflow.id,
        {},
        {
          limit: 10,
          offset: 0,
        },
      );
      expect(history.items).toHaveLength(1);

      const stopped = await server.call(`/plugins/webhooks/in/${spaceId}/stop`);
      expect(stopped.status).toBe(202);
    });
  });
});

describe('without the workflows plugin', () => {
  let server: WebhookServer;

  beforeAll(async () => {
    server = await bootWebhookServer('webhooks_alone');
  }, 60_000);

  afterAll(async () => {
    await server?.close();
  });

  it('still receives, logs and fires webhooks:received', async () => {
    const spaceId = await server.space();
    const hook = await server.services().webhooks.create(spaceId, {
      direction: 'incoming',
      name: 'Alone',
      slug: 'alone',
      auth: { mode: 'none' },
      enabled: true,
    });
    const seen: unknown[] = [];
    const off = server.api.manablox.hooks.on('webhooks:received', (call) => {
      seen.push(call.payload.body);
    });
    try {
      const response = await server.call(`/plugins/webhooks/in/${spaceId}/alone`, {
        body: '{"hello":true}',
      });
      expect(response.status).toBe(202);
      expect(await json(response)).toMatchObject({ runs: 0, aborted: 0 });
    } finally {
      off();
    }
    expect(seen).toEqual([{ hello: true }]);
    expect((await server.services().webhooks.get(spaceId, hook.id)).listeners).toBe(0);
    const rows = await webhookRepos(server.api.repos).pageDeliveries(hook.id);
    expect(rows.items[0]).toMatchObject({ status: 202, runIds: [] });
  });
});
