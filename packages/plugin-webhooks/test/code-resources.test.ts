import { defineCredential, ManabloxError } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import { workflowRepos } from '@manablox/plugin-workflows';
import {
  defineWorkflow,
  WORKFLOW_RESOURCE_KIND,
  type WorkflowDefinition,
} from '@manablox/plugin-workflows/define';
import { CodeResourceService, type SyncChange } from '@manablox/services';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  defineWebhook,
  WEBHOOK_RESOURCE_KIND,
  type WebhookDefinition,
  webhookAbort,
  webhookTrigger,
} from '../src/define.js';
import { webhookRepos } from '../src/server/db/index.js';
import { createWebhookHarness, type WebhookHarness } from './helpers/harness.js';

/** An empty signing slot, an endpoint signing with it, and a workflow started by the endpoint. */
const github = defineCredential({ slug: 'github', kind: 'signing' });
const incoming = defineWebhook({
  slug: 'from-github',
  direction: 'incoming',
  auth: { mode: 'hmac', credential: 'github' },
});
const onPush = defineWorkflow({
  slug: 'on-push',
  enabled: true,
  trigger: webhookTrigger('from-github'),
  steps: [{ key: 'tell', action: 'transform.json', config: { template: '{}' } }],
});

let h: WebhookHarness;

/** The reconciler over these declarations; the resolved config is frozen, so it is shadowed. */
function withResources(
  webhooks: WebhookDefinition[],
  workflows: WorkflowDefinition[],
): CodeResourceService {
  const instance = Object.create(h.manablox) as Manablox;
  const stamp = <T>(entries: T[]) => entries.map((entry) => ({ ...entry, sourceRef: 'config' }));
  Object.defineProperty(instance, 'config', {
    value: {
      ...h.manablox.config,
      resources: {
        ...h.manablox.config.resources,
        credentials: stamp([github]),
        plugins: {
          [WEBHOOK_RESOURCE_KIND]: stamp(webhooks),
          [WORKFLOW_RESOURCE_KIND]: stamp(workflows),
        },
      },
    },
  });
  return new CodeResourceService(instance, h.repos, {
    content: h.ctx.content,
    credentials: h.credentials,
  });
}

const find = (changes: SyncChange[], slug: string): SyncChange | undefined =>
  changes.find((change) => change.slug === slug);

beforeAll(async () => {
  h = await createWebhookHarness('webhook_code_resources', { listen: false });
});

afterAll(async () => {
  await h?.close();
});

beforeEach(async () => {
  // Every test starts from an empty space.
  const store = workflowRepos(h.repos).workflows;
  for (const row of await store.listBySpace(h.spaceId)) await store.delete(row.id);
  for (const row of await webhookRepos(h.repos).listBySpace(h.spaceId)) {
    await webhookRepos(h.repos).delete(row.id);
  }
  for (const row of await h.repos.credentials.listBySpace(h.spaceId)) {
    await h.repos.credentials.delete(row.id);
  }
});

describe('code-declared endpoints', () => {
  it('writes the endpoint and the workflow it starts, with its references resolved', async () => {
    const report = await withResources([incoming], [onPush]).sync();
    expect(report.changes.every((change) => change.action === 'created')).toBe(true);
    expect(find(report.changes, 'from-github')?.kind).toBe(WEBHOOK_RESOURCE_KIND);

    const [endpoint] = await webhookRepos(h.repos).listBySpace(h.spaceId);
    const [credential] = await h.repos.credentials.listBySpace(h.spaceId);
    expect(endpoint).toMatchObject({
      slug: 'from-github',
      source: 'code',
      authMode: 'hmac',
      credentialId: credential?.id,
      // `github` is declared without values, so the endpoint that signs with it is off.
      enabled: false,
    });
    const [workflow] = await workflowRepos(h.repos).workflows.listBySpace(h.spaceId);
    expect(workflow?.trigger).toEqual({ kind: 'webhook', webhookId: endpoint?.id, filter: null });
    expect(workflow?.enabled).toBe(true);

    const again = await withResources([incoming], [onPush]).sync();
    expect(again.changes.filter((change) => change.action !== 'unchanged')).toEqual([]);
  });

  it('resolves the endpoint an abort trigger names, and keeps its id across syncs', async () => {
    const guarded = defineWorkflow({
      slug: 'guarded',
      trigger: { kind: 'event', events: ['content.saved'] },
      abortOn: [
        { kind: 'event', events: ['content.deleted'], match: 'document' },
        webhookAbort('from-github', {
          match: { key: { run: '{{ content.id }}', abort: '{{ payload.body.id }}' } },
        }),
      ],
      steps: [{ key: 'tell', action: 'transform.json', config: { template: '{}' } }],
    });
    const service = withResources([incoming], [guarded]);
    await service.sync();
    const [endpoint] = await webhookRepos(h.repos).listBySpace(h.spaceId);
    const [workflow] = await workflowRepos(h.repos).workflows.listBySpace(h.spaceId);
    expect(workflow?.abortTriggers).toEqual([
      expect.objectContaining({
        kind: 'event',
        match: expect.objectContaining({ mode: 'document' }),
      }),
      expect.objectContaining({
        kind: 'webhook',
        webhookId: endpoint?.id,
        match: { mode: 'key', runKey: '{{ content.id }}', abortKey: '{{ payload.body.id }}' },
      }),
    ]);
    const again = await service.sync();
    expect(find(again.changes, 'guarded')?.action).toBe('unchanged');
  });

  it('reports the same on a dry run as a real run does, endpoints of the pass included', async () => {
    const service = withResources([incoming], [onPush]);
    const planned = await service.sync({ dryRun: true });
    expect(await webhookRepos(h.repos).listBySpace(h.spaceId)).toEqual([]);
    const done = await service.sync();
    expect(planned.changes).toEqual(done.changes);
    expect(find(planned.changes, 'on-push')?.action).toBe('created');
  });

  it('skips a workflow whose endpoint is declared nowhere', async () => {
    const report = await withResources([], [onPush]).sync();
    expect(find(report.changes, 'on-push')).toMatchObject({ action: 'skipped' });
  });

  it('runs webhooks:beforeCreate for a new endpoint; a refused one is skipped, the sync goes on', async () => {
    const seen: unknown[] = [];
    const off = h.manablox.hooks.on('webhooks:beforeCreate', (payload) => {
      seen.push(payload);
      throw ManabloxError.forbidden('auth.forbidden');
    });
    const service = withResources([incoming], []);
    let report: Awaited<ReturnType<CodeResourceService['sync']>>;
    try {
      report = await service.sync();
    } finally {
      off();
    }
    expect(seen).toEqual([{ spaceId: h.spaceId, direction: 'incoming', name: incoming.name }]);
    expect(find(report.changes, 'from-github')).toMatchObject({
      action: 'skipped',
      reason: 'refused: auth.forbidden',
    });
    expect(find(report.changes, 'github')?.action).toBe('created');
    expect(await webhookRepos(h.repos).listBySpace(h.spaceId)).toEqual([]);

    // An endpoint that exists is not created again, so the hook stays out of it.
    await service.sync();
    const again = h.manablox.hooks.on('webhooks:beforeCreate', () => {
      throw ManabloxError.forbidden('auth.forbidden');
    });
    try {
      expect(find((await service.sync()).changes, 'from-github')?.action).toBe('unchanged');
    } finally {
      again();
    }
  });

  it('syncs the endpoint into every environment under its own id', async () => {
    const staging = await h.repos.environments.create({
      spaceId: h.spaceId,
      machineName: 'staging',
      name: 'Staging',
      kind: 'staging',
    });
    try {
      const report = await withResources([incoming], [onPush]).sync();
      const scope = { spaceId: h.spaceId, environmentId: staging.id };
      const [endpoint] = await webhookRepos(h.repos).listBySpace(scope);
      const [workflow] = await workflowRepos(h.repos).workflows.listBySpace(scope);
      expect(endpoint).toMatchObject({ environmentId: staging.id, source: 'code' });
      expect(workflow?.trigger).toMatchObject({ webhookId: endpoint?.id });
      const [production] = await webhookRepos(h.repos).listBySpace(h.spaceId);
      expect(production?.id).not.toBe(endpoint?.id);
      const stagingKinds = report.changes
        .filter((change) => change.environment === 'staging')
        .map((change) => change.kind);
      expect([...new Set(stagingKinds)].sort()).toEqual([
        WEBHOOK_RESOURCE_KIND,
        WORKFLOW_RESOURCE_KIND,
      ]);
    } finally {
      await h.repos.environments.delete(staging.id);
    }
  });
});
