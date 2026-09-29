import { randomUUID } from 'node:crypto';
import { databaseContextOf } from '@manablox/db';
import { workflowRepos } from '@manablox/plugin-workflows';
import {
  EnvironmentLifecycleService,
  pruneRetention,
  SnapshotService,
  type SpaceExport,
  SpaceTransferService,
} from '@manablox/services';
import { withControls } from '@manablox/services/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ExportedWebhook, webhooksData } from '../src/server/data.js';
import { type WebhookRow, webhookRepos, webhookTables } from '../src/server/db/index.js';
import { action, chain } from './helpers/graph.js';
import { createWebhookHarness, type WebhookHarness } from './helpers/harness.js';
import { memoryStorage } from './helpers/storage.js';

let h: WebhookHarness;
let environments: EnvironmentLifecycleService;
let snapshots: SnapshotService;
let ownerId: string;
let counter = 0;
const storage = memoryStorage();

/** The endpoints' section of a space export. */
const SECTION = webhooksData.kind;

const DAY = 24 * 60 * 60_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

beforeAll(async () => {
  h = await createWebhookHarness('webhook_data', { listen: false });
  snapshots = new SnapshotService(
    h.manablox,
    h.repos,
    h.ctx.spaces,
    new SpaceTransferService(h.manablox, h.repos, storage),
    storage,
    { controlStore: h.ctx.controlStore },
  );
  environments = new EnvironmentLifecycleService(h.manablox, h.repos, {
    contentTypes: h.ctx.contentTypes,
    snapshots,
    promotes: h.ctx.controlStore.promotes,
  });
  const owner = await h.repos.users.create({
    name: 'Owner',
    email: 'owner@data.test',
    role: 'superadmin',
    passwordHash: 'x',
  });
  ownerId = owner.id;
});
afterAll(async () => {
  await h?.close();
});

const store = () => webhookRepos(h.repos);

/** A space with an outgoing endpoint and an incoming one behind a credential. */
async function freshSpace() {
  const machineName = `hooks-${++counter}-${randomUUID().slice(0, 6)}`;
  const space = await h.ctx.spaces.create(
    { name: machineName, machineName, url: 'http://hooks.test' },
    null,
  );
  const spaceId = space.id;
  const production = await h.repos.environments.production(spaceId);
  if (!production) throw new Error('no production');
  const credential = await h.credentials.create(spaceId, {
    name: 'Shop token',
    kind: 'bearer',
    data: { token: 'tok' },
  });
  const deploy = await store().create({
    spaceId,
    name: 'Deploy',
    slug: 'deploy',
    url: 'https://example.com/hook',
    events: ['content.published'],
  });
  const callback = await store().create({
    spaceId,
    direction: 'incoming',
    name: 'Callback',
    slug: 'callback',
    authMode: 'bearer',
    credentialId: credential.id,
    enabled: true,
  });
  return { spaceId, production, credential, deploy, callback };
}

/** The export under a new identity, so it imports into the same instance. */
function asCopy(payload: SpaceExport, machineName: string): SpaceExport {
  const rows: Array<{ id: string }> = [
    payload.space,
    ...((payload.plugins?.[SECTION] ?? []) as ExportedWebhook[]),
    ...(payload.credentials ?? []),
  ];
  let json = JSON.stringify(payload);
  for (const row of rows) json = json.replaceAll(row.id, randomUUID());
  const copy = JSON.parse(json) as SpaceExport;
  copy.space.machineName = machineName;
  return copy;
}

describe('the transfer section', () => {
  it('carries runtime endpoints; one needing a credential arrives off', async () => {
    const seed = await freshSpace();
    const payload = await h.ctx.spaces.export(seed.spaceId, {
      sections: [SECTION, 'credentials'],
    });
    expect(payload.sections).toEqual(['credentials', SECTION]);
    const entries = payload.plugins?.[SECTION] as ExportedWebhook[];
    expect(entries.find((entry) => entry.name === 'Deploy')).not.toHaveProperty('secret');
    expect((await h.ctx.spaces.inventory(seed.spaceId)).plugins[SECTION]).toBe(2);

    const copy = asCopy(payload, `copy-${counter}`);
    const result = await h.ctx.spaces.import(copy, ownerId);
    expect(result.plugins).toMatchObject({ [SECTION]: 2 });
    const restored = await store().listBySpace(result.spaceId);
    expect(restored.find((row) => row.name === 'Deploy')).toMatchObject({
      enabled: true,
    });
    // Disabled, still pointing at its empty credential.
    expect(restored.find((row) => row.name === 'Callback')).toMatchObject({
      enabled: false,
      credentialId: copy.credentials?.[0]?.id,
    });
    const created = await h.repos.audit.page({
      spaceId: result.spaceId,
      actions: ['webhooks.webhook.create'],
    });
    expect(created.items.map((row) => row.meta)).toEqual(
      Array(2).fill(expect.objectContaining({ via: 'space.import' })),
    );
  });

  it('runs webhooks:beforeCreate for each endpoint before anything is written', async () => {
    const seed = await freshSpace();
    const copy = asCopy(
      await h.ctx.spaces.export(seed.spaceId, { sections: [SECTION] }),
      `refused-${counter}`,
    );
    const seen: unknown[] = [];
    const off = h.manablox.hooks.on('webhooks:beforeCreate', (row) => {
      seen.push(row);
      throw new Error('no endpoints here');
    });
    try {
      await expect(h.ctx.spaces.import(copy, ownerId)).rejects.toThrow('no endpoints here');
    } finally {
      off();
    }
    expect(seen).toEqual([
      expect.objectContaining({ spaceId: copy.space.id, direction: expect.any(String) }),
    ]);
    expect(await h.repos.spaces.findById(copy.space.id)).toBeNull();
  });
});

describe('snapshots', () => {
  it('switches an endpoint back on once a same-instance restore brings its secret along', async () => {
    const seed = await freshSpace();
    const restore = await withControls(h.ctx, {
      scope: { kind: 'space', id: seed.spaceId },
      features: { snapshots: true },
    });
    try {
      const manifest = await snapshots.create(seed.spaceId);
      const result = await snapshots.restore(seed.spaceId, manifest.id, {
        mode: 'new',
        actorId: ownerId,
      });
      const restored = await store().listBySpace(result.spaceId);
      const callback = restored.find((row) => row.name === 'Callback');
      expect(callback).toMatchObject({ enabled: true });
      expect(callback?.id).not.toBe(seed.callback.id);
      const [credential] = await h.repos.credentials.listBySpace(result.spaceId);
      expect(callback?.credentialId).toBe(credential?.id);
    } finally {
      await restore();
    }
  });
});

describe('environments', () => {
  const staging = (spaceId: string) =>
    environments.create(spaceId, { machineName: 'staging', name: 'Staging', mode: 'config' });

  it('copies endpoints switched off under new ids and never promotes them', async () => {
    const seed = await freshSpace();
    const { environment, copied } = await staging(seed.spaceId);
    const copies = await store().listByEnvironment(environment.id);
    expect(copies.map((row) => [row.name, row.enabled]).sort()).toEqual([
      ['Callback', false],
      ['Deploy', false],
    ]);
    expect(copies.map((row) => row.id)).not.toContain(seed.deploy.id);
    expect(copied).toMatchObject({ webhooks: 2 });

    const deploy = copies.find((row) => row.name === 'Deploy') as WebhookRow;
    await store().update(deploy.id, { name: 'Changed in staging', url: 'https://staging.test' });
    await store().create({
      spaceId: seed.spaceId,
      environmentId: environment.id,
      name: 'Only in staging',
      slug: 'only',
      url: 'https://only.test',
    });
    const diff = await environments.diff(seed.spaceId, 'staging', 'config');
    // Endpoints are never promoted, so neither the diff nor the promote lists them.
    expect(diff.changes.map((entry) => entry.kind)).not.toContain('webhooks');
    const result = await environments.promote(seed.spaceId, 'staging', 'config');
    expect(result.groups.map((group) => group.group)).not.toContain('webhooks');
    const live = await store().listByEnvironment(seed.production.id);
    expect(live.map((row) => [row.id, row.name, row.enabled]).sort()).toEqual(
      [
        [seed.deploy.id, 'Deploy', true],
        [seed.callback.id, 'Callback', true],
      ].sort(),
    );
  });

  it('points promoted workflows at the production endpoint of the same direction and slug', async () => {
    const seed = await freshSpace();
    const workflows = workflowRepos(h.repos).workflows;
    const workflow = await h.service.create(
      seed.spaceId,
      {
        name: 'On callback',
        trigger: { kind: 'webhook', webhookId: seed.callback.id, filter: null },
        ...chain(action('shape', 'transform.json', { template: '{}' })),
      },
      { publish: true },
    );
    const { environment } = await staging(seed.spaceId);
    const [copy] = await workflows.listByEnvironment(environment.id);
    const stagingHook = (await store().listByEnvironment(environment.id)).find(
      (row) => row.slug === 'callback',
    );
    expect(copy?.trigger).toMatchObject({ webhookId: stagingHook?.id });
    await workflows.updateRow(copy?.id as string, { name: 'Renamed' });
    await environments.promote(seed.spaceId, 'staging', 'config');
    const live = await workflows.findById(workflow.id);
    expect(live).toMatchObject({ name: 'Renamed', trigger: { webhookId: seed.callback.id } });
  });
});

describe('retention', () => {
  it('prunes deliveries past retention.plugins.webhooks.deliveriesDays', async () => {
    const seed = await freshSpace();
    const context = databaseContextOf(h.repos);
    const { webhookDeliveries } = webhookTables(context);
    for (const age of [30, 1]) {
      const row = await store().createDelivery({
        webhookId: seed.deploy.id,
        spaceId: seed.spaceId,
        event: 'content.published',
        payload: {},
        status: 200,
        error: null,
      });
      await context.db
        .update(webhookDeliveries)
        .set({ createdAt: daysAgo(age) })
        .where(eq(webhookDeliveries.id, row.id));
    }
    const restore = await withControls(h.ctx, {
      scope: { kind: 'space', id: seed.spaceId },
      values: { 'retention.plugins.webhooks.deliveriesDays': 7 },
    });
    try {
      const report = await pruneRetention(h.manablox, h.repos);
      expect(report['plugins.webhooks.deliveriesDays']).toBe(1);
      expect((await store().pageDeliveries(seed.deploy.id)).total).toBe(1);
    } finally {
      await restore();
    }
  });
});
