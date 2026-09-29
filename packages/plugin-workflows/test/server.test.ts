import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ResolvedScope } from '@manablox/core';
import { builtinFieldTypes } from '@manablox/fields';
import { bootstrap, createApp, requireManagement } from '@manablox/server';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { WorkflowTrigger } from '../src/sdk.js';
import { workflowRepos } from '../src/server/db/index.js';
import { workflowsPlugin } from '../src/server/plugin.js';
import { bootWorkflowServer, shapeGraph, type WorkflowServer } from './helpers/server.js';

let server: WorkflowServer;
let app: Hono;

const onCreate = {
  kind: 'event',
  events: ['content.created'],
  typeIds: [],
  locales: [],
} as unknown as WorkflowTrigger;
const manual = { kind: 'manual', parameters: [] } as unknown as WorkflowTrigger;

/** Runs of a workflow so far. */
const runsOf = async (workflowId: string) =>
  (
    await workflowRepos(server.api.repos).runs.pageByWorkflow(
      workflowId,
      {},
      { limit: 50, offset: 0 },
    )
  ).total;

beforeAll(async () => {
  server = await bootWorkflowServer('workflows_server');
  app = await createApp(server.api);
}, 90_000);

afterAll(async () => {
  await server?.close();
});

describe('the workflows plugin on a booted instance', () => {
  it('builds its services and reaches the core ones', () => {
    const services = server.api.manablox.plugins.require('workflows');
    expect(services).toBe(server.api.manablox.plugin('workflows').services);
    expect(services.workflows).toBeDefined();
    expect(services.registry.triggerKinds.map((kind) => kind.kind)).toEqual(
      expect.arrayContaining(['event', 'schedule', 'call', 'manual']),
    );
  });

  it('starts the clock for scheduled workflows in start', () => {
    const engine = server.services().engine as unknown as { timer: unknown };
    expect(engine.timer).not.toBeNull();
  });

  it('runs a queued run through the workflows:run job', async () => {
    const spaceId = await server.space();
    const workflow = await server.workflow(spaceId, 'By hand', manual);
    const run = await workflowRepos(server.api.repos).runs.create({
      workflowId: workflow.id,
      spaceId,
      trigger: 'manual',
      // The engine reads what it needs from the workflow; a bare context will do here.
      context: {} as never,
      version: workflow.publishedVersion,
    });
    expect(run.status).toBe('queued');
    await server.api.jobs.enqueue('workflows:run', { runId: run.id });
    await server.api.jobs.idle();
    await server.services().engine.idle();
    expect(await workflowRepos(server.api.repos).runs.findStatus(run.id)).toBe('succeeded');
  });

  it("runs an environment's workflows on its content events only", async () => {
    const { api } = server;
    const spaceId = await server.space();
    const fields = [{ name: 'summary', type: 'string' }];
    const row = await api.repos.environments.create({
      spaceId,
      machineName: 'staging',
      name: 'Staging',
      kind: 'staging',
    });
    const staging: ResolvedScope = await api.environments.scope(spaceId, row.machineName);
    const articleId = (await api.contentTypes.create({ name: 'article', spaceId, fields })).id;
    const stagingArticleId = (
      await api.contentTypes.create({ name: 'article', spaceId, fields }, null, staging)
    ).id;

    const workflow = await server.workflow(staging, 'On staging create', onCreate);
    server.services().engine.forgetLive();
    const before = await runsOf(workflow.id);
    await api.content.create({ spaceId, typeId: articleId, title: 'Prod', fields: {} });
    expect(await runsOf(workflow.id)).toBe(before);
    await api.content.create({
      spaceId,
      environmentId: staging.environmentId,
      typeId: stagingArticleId,
      title: 'Staged',
      fields: {},
    });
    expect(await runsOf(workflow.id)).toBe(before + 1);
  });

  it('adds its section to the LLM guide', async () => {
    const short = await (await app.request('/llms.txt')).text();
    expect(short).toContain('### Workflows');
    expect(short).not.toContain('#### Workflow triggers and actions');
    const full = await (await app.request('/llms-full.txt')).text();
    expect(full).toContain('#### Workflow triggers and actions');
    expect(full).toContain('`content.created`');
  });
});

const redisUrl = process.env.TEST_REDIS_URL ?? '';

describe.skipIf(!redisUrl)('the workflows plugin over Redis', () => {
  it('drops the live-trigger index on the other replicas when workflows change', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'manablox-workflows-replicas-'));
    const boot = async () =>
      requireManagement(
        await bootstrap({
          database: { url: server.db.url },
          cache: { redisUrl },
          auth: { secret: 'workflows-plugin-secret-0123456789' },
          fieldTypes: builtinFieldTypes,
          logLevel: 'silent',
          storage: { driver: 'local', local: { path: join(dir, 'files') } },
          plugins: [workflowsPlugin()],
        }),
      );
    const one = await boot();
    const two = await boot();
    try {
      const forget = vi.spyOn(two.manablox.plugins.require('workflows').engine, 'forgetLive');
      // Subscribing is asynchronous; an announcement before it would be missed.
      await new Promise((resolve) => setTimeout(resolve, 200));
      const spaceId = await server.space();
      await one.manablox.plugins
        .require('workflows')
        .workflows.create(
          spaceId,
          { name: 'On save', trigger: onCreate, ...shapeGraph, enabled: true },
          { publish: true },
        );
      await vi.waitFor(() => expect(forget).toHaveBeenCalledWith(spaceId));
    } finally {
      await one.shutdown();
      await two.shutdown();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
