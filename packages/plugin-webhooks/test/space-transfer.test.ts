import {
  type ExportedWorkflowEntry,
  workflowRepos,
  workflowsData,
} from '@manablox/plugin-workflows';
import type { SpaceExport } from '@manablox/services';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ExportedWebhook, webhooksData } from '../src/server/data.js';
import { webhookRepos } from '../src/server/db/index.js';
import { action, chain } from './helpers/graph.js';
import { createWebhookHarness, type WebhookHarness } from './helpers/harness.js';

let h: WebhookHarness;
let ownerId: string;
const ids: Record<string, string> = {};

/** The workflows plugin's section of a space export. */
const SECTION = workflowsData.kind;
/** The endpoints' section. */
const HOOKS = webhooksData.kind;

const entriesOf = (payload: SpaceExport) =>
  (payload.plugins?.[SECTION] ?? []) as ExportedWorkflowEntry[];

/** The export under fresh ids for every row, so it imports into the same instance. */
function asCopy(payload: SpaceExport, machineName: string): SpaceExport {
  const rows = [
    payload.space,
    ...entriesOf(payload),
    ...((payload.plugins?.[HOOKS] ?? []) as ExportedWebhook[]),
    ...(payload.credentials ?? []),
  ];
  let json = JSON.stringify(payload);
  for (const row of rows) json = json.replaceAll(row.id, crypto.randomUUID());
  const copy = JSON.parse(json) as SpaceExport;
  copy.space.machineName = machineName;
  return copy;
}

const exportFlows = () =>
  h.ctx.spaces.export(h.spaceId, { sections: [SECTION, HOOKS, 'credentials'] });

beforeAll(async () => {
  h = await createWebhookHarness('webhook_space_transfer', { listen: false });
  const signing = await h.credentials.create(h.spaceId, {
    name: 'Shop signing',
    kind: 'signing',
    data: { secret: 'shh' },
  });
  const orders = await h.webhooks.create(h.spaceId, {
    direction: 'incoming',
    name: 'Orders',
    auth: { mode: 'hmac', credentialId: signing.id },
  });
  const cancelled = await h.webhooks.create(h.spaceId, {
    direction: 'incoming',
    name: 'Cancelled',
  });
  const workflow = await h.workflow(
    'Receive order',
    { kind: 'webhook', webhookId: orders.id, filter: null },
    chain(action('ship', 'transform.json', { template: '{}' })),
    {
      abortTriggers: [
        {
          id: '',
          kind: 'webhook',
          webhookId: cancelled.id,
          filter: null,
          match: { mode: 'all', runKey: '', abortKey: '' },
        },
      ],
    },
  );
  Object.assign(ids, { orders: orders.id, workflow: workflow.id });
  const owner = await h.repos.users.create({
    name: 'Importer',
    email: 'importer@example.com',
    role: 'editor',
    passwordHash: 'x',
  });
  ownerId = owner.id;
});

afterAll(async () => {
  await h?.close();
});

describe('space transfer of webhook workflows', () => {
  it('keeps the workflows wired to the endpoints the space import brings along', async () => {
    const copy = asCopy(await exportFlows(), 'wired');
    const result = await h.ctx.spaces.import(copy, ownerId);
    expect(result).toMatchObject({ credentials: 1, notes: [] });
    expect(result.plugins).toMatchObject({ [SECTION]: 1, [HOOKS]: 2 });

    const hooks = await webhookRepos(h.repos).listBySpace(result.spaceId, 'incoming');
    const bySlug = (slug: string) => hooks.find((row) => row.slug === slug);
    const [workflow] = await workflowRepos(h.repos).workflows.listBySpace(result.spaceId);
    expect(workflow).toMatchObject({ name: 'Receive order', enabled: true, publishedVersion: 1 });
    expect(workflow?.trigger).toMatchObject({ kind: 'webhook', webhookId: bySlug('orders')?.id });
    expect(workflow?.abortTriggers).toEqual([
      expect.objectContaining({ kind: 'webhook', webhookId: bySlug('cancelled')?.id }),
    ]);
    // The endpoint came in with its own section, audited like the workflows'.
    const created = await h.repos.audit.page({
      spaceId: result.spaceId,
      actions: ['webhooks.webhook.create'],
    });
    expect(created.items.map((row) => row.meta)).toEqual(
      Array(2).fill(expect.objectContaining({ direction: 'incoming', via: 'space.import' })),
    );
  });

  it('recreates what the workflows need when endpoints and credentials stay behind', async () => {
    const copy = asCopy(await exportFlows(), 'workflows-only');
    const result = await h.ctx.spaces.import(copy, ownerId, { sections: [SECTION] });
    expect(result).toMatchObject({ credentials: 0 });
    expect(result.plugins).toMatchObject({ [SECTION]: 1, [HOOKS]: 0 });
    expect(result.notes).toEqual([
      'Created the credential "Shop signing"; fill in its secret.',
      'Created the incoming webhook "Cancelled", switched off.',
      'Created the incoming webhook "Orders", switched off.',
    ]);

    const hooks = await webhookRepos(h.repos).listBySpace(result.spaceId, 'incoming');
    const orders = hooks.find((row) => row.slug === 'orders');
    const credentials = await h.repos.credentials.listBySpace(result.spaceId);
    expect(orders).toMatchObject({ enabled: false, authMode: 'hmac' });
    expect(credentials.find((row) => row.id === orders?.credentialId)?.slug).toBe('shop-signing');
    const [workflow] = await workflowRepos(h.repos).workflows.listBySpace(result.spaceId);
    expect(workflow?.trigger).toMatchObject({ webhookId: orders?.id });
    const created = await h.repos.audit.page({
      spaceId: result.spaceId,
      actions: ['webhooks.webhook.create', 'credential.create'],
    });
    expect(created.items.map((row) => row.meta)).toEqual(
      Array(3).fill(expect.objectContaining({ via: 'space.import' })),
    );
  });
});
