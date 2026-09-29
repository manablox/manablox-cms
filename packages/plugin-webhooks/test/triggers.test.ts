import { AuditRepository } from '@manablox/db';
import {
  planImport,
  readWorkflowFile,
  type WorkflowImportSource,
  WorkflowRepository,
} from '@manablox/plugin-workflows';
import type { WorkflowSnapshot, WorkflowTrigger } from '@manablox/plugin-workflows/sdk';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebhookAbortTrigger, WebhookTrigger } from '../src/define.js';
import { webhookRepos } from '../src/server/db/index.js';
import { abortOn, action, chain, delay, onEvents } from './helpers/graph.js';
import { createWebhookHarness, type WebhookHarness } from './helpers/harness.js';

let h: WebhookHarness;

/** A switched-off draft, never published. */
const draft = (name: string, trigger: WorkflowTrigger, graph = chain(shape('a', '{}'))) =>
  h.service.create(h.spaceId, { name, trigger, ...graph });

const shape = (key: string, template: string) => action(key, 'transform.json', { template });
const onCall = (webhookId: string | null, filter: WebhookTrigger['filter'] = null) =>
  ({ kind: 'webhook', webhookId, filter }) as WorkflowTrigger;
const abortOnCall = (webhookId: string | null, match: WebhookAbortTrigger['match']) =>
  ({ id: '', kind: 'webhook', webhookId, filter: null, match }) as WebhookAbortTrigger;

/** A JSON call to an endpoint of the space. */
const call = (slug: string, body: Record<string, unknown>) =>
  h.webhooks.receive(h.spaceId, slug, {
    method: 'POST',
    raw: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    query: {},
  });

beforeAll(async () => {
  h = await createWebhookHarness('webhook_triggers');
});

afterAll(async () => {
  await h?.close();
});

beforeEach(async () => {
  await h.engine.idle();
});

describe('incoming calls', () => {
  it('starts every workflow pointed at the endpoint, and honours a filter', async () => {
    const hook = await h.webhooks.create(h.spaceId, { direction: 'incoming', name: 'Shop' });
    const other = await h.webhooks.create(h.spaceId, { direction: 'incoming', name: 'Other' });

    const always = await h.workflow('Any call', onCall(hook.id), chain(shape('any_call', '{}')));
    const onlyOpened = await h.workflow(
      'Only opened',
      onCall(hook.id, {
        match: 'all',
        rules: [{ field: 'payload.body.action', operator: 'equals', value: 'opened' }],
      }),
      chain(shape('only_opened', '{}')),
    );
    const elsewhere = await h.workflow(
      'Another endpoint',
      onCall(other.id),
      chain(shape('elsewhere', '{}')),
    );

    const result = await call(hook.slug, { action: 'closed' });
    await h.engine.idle();

    // The filtered workflow and the other endpoint did not run.
    expect(result.runIds).toHaveLength(1);
    expect(result.abortedRunIds).toEqual([]);
    expect((await h.runsOf(always.id))[0]?.status).toBe('succeeded');
    expect(await h.runsOf(onlyOpened.id)).toHaveLength(0);
    expect(await h.runsOf(elsewhere.id)).toHaveLength(0);

    // The call is stored on the run.
    const run = (await h.runsOf(always.id))[0];
    expect(run?.trigger).toBe('webhook');
    expect(run?.context.payload).toMatchObject({ body: { action: 'closed' }, method: 'POST' });
    expect(run?.context.webhook).toMatchObject({ slug: hook.slug });

    await call(hook.slug, { action: 'opened' });
    await h.engine.idle();
    expect(await h.runsOf(onlyOpened.id)).toHaveLength(1);
  });

  it('aborts only the runs whose key matches the call', async () => {
    const start = await h.webhooks.create(h.spaceId, {
      direction: 'incoming',
      name: 'Order placed',
    });
    const cancel = await h.webhooks.create(h.spaceId, {
      direction: 'incoming',
      name: 'Order cancelled',
    });
    const wf = await h.workflow('Ship', onCall(start.id), chain(delay('pack', 60)), {
      abortTriggers: [
        abortOnCall(cancel.id, {
          mode: 'key',
          runKey: '{{ payload.body.order }}',
          abortKey: '{{ payload.body.order }}',
        }),
      ],
    });
    await call(start.slug, { order: 1 });
    await call(start.slug, { order: 2 });
    await h.engine.idle();

    const result = await call(cancel.slug, { order: 1 });
    await h.engine.idle();

    expect(result.abortedRunIds).toHaveLength(1);
    expect(result.runIds).toEqual([]);
    const runs = await h.runsOf(wf.id);
    const status = (order: number) =>
      runs.find((run) => (run.context.payload?.body as { order: number }).order === order)?.status;
    expect(status(1)).toBe('aborted');
    expect(status(2)).toBe('waiting');
    expect(runs.find((run) => run.status === 'aborted')?.abort).toMatchObject({
      event: cancel.slug,
    });
    // Each endpoint counts the workflow listening on it.
    expect((await h.webhooks.get(h.spaceId, cancel.id)).listeners).toBe(1);
    expect((await h.webhooks.get(h.spaceId, start.id)).listeners).toBe(1);
  });

  it('starts nothing while workflows are off in the space, and still logs the call', async () => {
    const hook = await h.webhooks.create(h.spaceId, { direction: 'incoming', name: 'Muted' });
    const wf = await h.workflow('Muted', onCall(hook.id), chain(shape('a', '{}')));
    const isOn = vi.spyOn(h.manablox.plugins, 'isOn').mockResolvedValue(false);
    try {
      expect(await call(hook.slug, { a: 1 })).toMatchObject({ runIds: [], abortedRunIds: [] });
    } finally {
      isOn.mockRestore();
    }
    await h.engine.idle();
    expect(await h.runsOf(wf.id)).toEqual([]);
    const deliveries = await h.webhooks.deliveries(h.spaceId, hook.id);
    expect(deliveries.items).toHaveLength(1);
  });
});

describe('checks', () => {
  it('refuses a webhook trigger that names an endpoint of another space', async () => {
    const other = await h.repos.spaces.create({
      name: 'Elsewhere',
      machineName: 'elsewhere',
      url: 'https://elsewhere.test',
    });
    const theirs = await h.webhooks.create(other.id, { direction: 'incoming', name: 'Theirs' });
    await expect(
      h.workflow('Borrowed', onCall(theirs.id), chain(shape('a', '{}'))),
    ).rejects.toMatchObject({
      key: 'plugins.workflows.validation.failed',
      details: [
        expect.objectContaining({
          key: 'plugins.webhooks.trigger.notFound',
          path: ['trigger', 'webhookId'],
        }),
      ],
    });
  });

  it('reports what a webhook trigger and abort trigger are missing', async () => {
    await expect(
      h.workflow('Bad', onCall(null), chain(shape('a', '{}')), {
        abortTriggers: [abortOnCall(null, { mode: 'all', runKey: '', abortKey: '' })],
      }),
    ).rejects.toMatchObject({
      details: [
        expect.objectContaining({ key: 'plugins.webhooks.trigger.required' }),
        expect.objectContaining({
          key: 'plugins.webhooks.abort.required',
          path: ['abortTriggers', 0, 'webhookId'],
        }),
      ],
    });
  });
});

describe('test runs', () => {
  it('hands a webhook workflow the sample call', async () => {
    const hook = await h.webhooks.create(h.spaceId, {
      direction: 'incoming',
      name: 'Shop sample',
    });
    const wf = await draft(
      'On a call',
      onCall(hook.id),
      chain(shape('got', '{ "action": "{{ payload.body.action }}" }')),
    );
    const run = await h.service.runNow(h.spaceId, wf.id, {
      payload: { body: { action: 'opened' }, query: {}, method: 'POST' },
      headers: { 'x-shop': 'eu' },
    });
    expect(run.context.payload?.body).toEqual({ action: 'opened' });
    expect(run.context.headers).toEqual({ 'x-shop': 'eu' });
    expect(run.state.outputs.got?.value).toEqual({ action: 'opened' });
  });
});

describe('the catalogue', () => {
  it('lists the incoming endpoints with their listeners, in a fixed number of reads', async () => {
    const hook = await h.webhooks.create(h.spaceId, { direction: 'incoming', name: 'Listed' });
    await h.workflow('Listed 1', onCall(hook.id), chain(shape('a', '{}')));
    await h.workflow('Listed 2', onEvents(['content.created']), chain(shape('a', '{}')), {
      abortTriggers: [abortOnCall(hook.id, { mode: 'all', runKey: '', abortKey: '' })],
    });

    h.ctx.resetQueryCount();
    const catalog = await h.service.catalog(h.spaceId);
    const reads = (table: string) =>
      h.ctx
        .queries()
        .filter((query) => /^\s*select/i.test(query) && query.includes(`from "${table}"`)).length;
    // The catalogue entry reuses the endpoints the kind's lookup read and the space lookups'
    // workflows; however many there are.
    expect(reads('webhooks')).toBe(1);
    expect(reads('workflows')).toBe(1);
    expect(catalog.triggerKinds.find((kind) => kind.kind === 'webhook')).toMatchObject({
      plugin: 'webhooks',
      label: 'When a webhook is called',
    });
    const listed = (catalog.triggers.webhook as Array<{ id: string; listeners: number }>).find(
      (entry) => entry.id === hook.id,
    );
    expect(listed?.listeners).toBe(2);
  });
});

describe('workflow files', () => {
  it('round-trips a workflow into another space, recreating its endpoint', async () => {
    const secret = await h.credentials.create(h.spaceId, {
      name: 'Shop signing',
      kind: 'signing',
      data: { secret: 'shh-very-secret' },
    });
    const hook = await h.webhooks.create(h.spaceId, {
      direction: 'incoming',
      name: 'Shop',
      auth: { mode: 'hmac', credentialId: secret.id },
    });
    const wf = await h.workflow(
      'Ship orders',
      onCall(hook.id),
      chain(delay('pack'), shape('ship', '{}')),
      { abortTriggers: [abortOn(['content.deleted'], { mode: 'document' })] },
    );

    const json = JSON.parse(JSON.stringify(await h.service.export(h.spaceId, wf.id)));
    expect(JSON.stringify(json)).not.toContain('shh-very-secret');
    expect(json.webhooks).toEqual([
      expect.objectContaining({ id: hook.id, slug: hook.slug, credentialId: secret.id }),
    ]);
    expect(json.credentials).toEqual([
      expect.objectContaining({ slug: secret.slug, kind: 'signing' }),
    ]);

    const other = await h.repos.spaces.create({
      name: 'Other',
      machineName: 'other-import',
      url: 'https://other.test',
    });
    const { workflow: imported, notes } = await h.service.import(other.id, json);

    expect(imported.enabled).toBe(false);
    expect(imported.nodes.map((node) => node.key)).toEqual(['pack', 'ship']);
    const [newHook] = await webhookRepos(h.repos).listBySpace(other.id, 'incoming');
    expect(newHook).toMatchObject({ slug: hook.slug, enabled: false, authMode: 'hmac' });
    expect(imported.trigger).toMatchObject({ kind: 'webhook', webhookId: newHook?.id });
    const [slot] = await h.repos.credentials.listBySpace(other.id);
    expect(slot).toMatchObject({ slug: secret.slug, data: null });
    expect(newHook?.credentialId).toBe(slot?.id);
    expect(notes).toEqual([
      'Created the credential "Shop signing"; fill in its secret.',
      'Created the incoming webhook "Shop", switched off.',
    ]);

    // Importing again reuses the endpoint and credential by slug, and renames the copy.
    const again = await h.service.import(other.id, json);
    expect(again.workflow.name).toBe('Ship orders (copy)');
    expect(again.notes).toEqual([]);
    expect(await webhookRepos(h.repos).listBySpace(other.id, 'incoming')).toHaveLength(1);
  });

  it('leaves out an endpoint with an unknown auth mode instead of opening it', () => {
    const file = readWorkflowFile(
      {
        format: 'manablox.workflow',
        version: 1,
        workflow: { name: 'x', trigger: { kind: 'event' }, nodes: [], edges: [] },
        webhooks: [
          { id: 'w1', slug: 'shop', authMode: 'magic' },
          { id: 'w2', slug: 'shop-2', authMode: 'none' },
        ],
      },
      h.registry,
    );
    expect(file.webhooks).toEqual([expect.objectContaining({ id: 'w2', authMode: 'none' })]);
  });

  it('creates no endpoint or credential when an import fails midway', async () => {
    const secret = await h.credentials.create(h.spaceId, {
      name: 'Atomic signing',
      kind: 'signing',
      data: { secret: 'shh' },
    });
    const hook = await h.webhooks.create(h.spaceId, {
      direction: 'incoming',
      name: 'Atomic hook',
      auth: { mode: 'hmac', credentialId: secret.id },
    });
    const wf = await draft('Atomic import', onCall(hook.id));
    const file = JSON.parse(JSON.stringify(await h.service.export(h.spaceId, wf.id)));
    const other = await h.repos.spaces.create({
      name: 'Atomic',
      machineName: 'atomic-import',
      url: 'https://atomic.test',
    });

    const failing = vi
      .spyOn(WorkflowRepository.prototype, 'create')
      .mockRejectedValueOnce(new Error('midway'));
    try {
      await expect(h.service.import(other.id, file)).rejects.toThrow('midway');
    } finally {
      failing.mockRestore();
    }
    expect(await webhookRepos(h.repos).listBySpace(other.id)).toEqual([]);
    expect(await h.repos.credentials.listBySpace(other.id)).toEqual([]);

    const { workflow } = await h.service.import(other.id, file);
    expect(workflow.name).toBe('Atomic import');
    expect(await webhookRepos(h.repos).listBySpace(other.id)).toHaveLength(1);
    expect(await h.repos.credentials.listBySpace(other.id)).toHaveLength(1);
  });

  it('keeps an endpoint when its audit entry fails', async () => {
    const hook = await h.webhooks.create(h.spaceId, { direction: 'incoming', name: 'Audited' });
    const entries = await h.repos.audit.count({});
    for (const attempt of [
      () => h.webhooks.setEnabled(h.spaceId, hook.id, false),
      () => h.webhooks.delete(h.spaceId, hook.id),
    ]) {
      const spy = vi
        .spyOn(AuditRepository.prototype, 'record')
        .mockRejectedValueOnce(new Error('midway'));
      try {
        await expect(attempt()).rejects.toThrow('midway');
      } finally {
        spy.mockRestore();
      }
    }
    expect(await h.webhooks.get(h.spaceId, hook.id)).toMatchObject({ enabled: true });
    expect(await h.repos.audit.count({})).toBe(entries);
  });
});

describe('planImport', () => {
  const hookEntry = (id: string, slug: string, credentialId: string | null = null) => ({
    id,
    name: slug,
    slug,
    description: null,
    methods: ['POST'],
    authMode: credentialId ? 'hmac' : 'none',
    credentialId,
    signatureHeader: 'x-signature',
    algorithm: 'sha256',
    signatureFormat: 'prefixed',
  });

  it('remaps endpoints and their credentials, reusing one by slug', () => {
    const draftSnapshot = {
      name: 'Orders',
      description: null,
      trigger: onCall('f-orders'),
      abortTriggers: [
        { id: 'x1', kind: 'webhook', webhookId: 'f-cancel', mode: 'all' },
        { id: 'x2', kind: 'webhook', webhookId: 'f-gone', mode: 'all' },
        { id: 'x3', kind: 'event', events: ['content.deleted'], typeIds: ['page', 'ghost'] },
      ],
      nodes: [],
      edges: [],
    } as unknown as WorkflowSnapshot;
    const source: WorkflowImportSource = {
      workflows: [{ id: 'a', draft: draftSnapshot, enabled: true, publish: true }],
      credentials: [
        { id: 'f-sign', name: 'Signing', slug: 'signing', kind: 'signing', provider: '' },
      ],
      records: {
        webhooks: [hookEntry('f-orders', 'orders', 'f-sign'), hookEntry('f-cancel', 'cancel')],
      },
      called: [],
    };
    const plan = planImport(
      source,
      {
        credentials: [],
        records: { webhooks: [{ id: 'cancel-here', slug: 'cancel' }] },
        workflows: [],
      },
      {
        registry: h.registry,
        typeExists: (typeId) => typeId === 'page',
        newId: (kind, id) => `${kind}:${id}`,
      },
    );

    expect(plan.records.webhooks).toEqual([
      expect.objectContaining({
        id: 'webhooks:f-orders',
        slug: 'orders',
        credentialId: 'credential:f-sign',
      }),
    ]);
    const planned = plan.workflows[0]?.draft;
    expect(planned?.trigger).toMatchObject({ kind: 'webhook', webhookId: 'webhooks:f-orders' });
    expect(planned?.abortTriggers).toEqual([
      expect.objectContaining({ id: 'x1', webhookId: 'cancel-here' }),
      expect.objectContaining({ id: 'x3', typeIds: ['page'] }),
    ]);
    expect(plan.notes).toEqual([
      'Created the credential "Signing"; fill in its secret.',
      'Created the incoming webhook "orders", switched off.',
      'Dropped an abort trigger whose webhook is not in the file.',
      'Dropped the unknown content type "ghost".',
    ]);
  });
});
