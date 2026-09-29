import { randomUUID } from 'node:crypto';
import { databaseContextOf } from '@manablox/db';
import { builtinFieldTypes } from '@manablox/fields';
import { createServiceContext, type ServiceContext } from '@manablox/services/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canMoveRun, type WorkflowRunStatus } from '../src/sdk.js';
import { type WorkflowRepos, workflowRepos, workflowTables } from '../src/server/db/index.js';
import { workflowsPlugin } from '../src/server/plugin.js';

let ctx: ServiceContext;
let repos: WorkflowRepos;
let otherSpaceId: string;

beforeAll(async () => {
  // A database with the plugin's tables; the repositories need nothing else of the plugin.
  ctx = await createServiceContext('workflow_db', {
    fieldTypes: builtinFieldTypes,
    contentTypes: [{ name: 'page', fields: [] }],
    config: { plugins: [workflowsPlugin()] },
  });
  repos = workflowRepos(ctx.repos);
  otherSpaceId = (
    await ctx.repos.spaces.create({ name: 'Other', machineName: 'other', url: 'http://o.test' })
  ).id;
});
afterAll(async () => {
  await ctx?.close();
});

const trigger = { kind: 'event' as const, events: [], typeIds: [], locales: [] };

describe('WorkflowRepository across spaces', () => {
  it('lists workflows per space in one pass, by name, with every asked space present', async () => {
    const { workflows } = repos;
    await workflows.create({ spaceId: ctx.spaceId, name: 'Zeta', trigger, nodes: [], edges: [] });
    await workflows.create({ spaceId: ctx.spaceId, name: 'Alpha', trigger, nodes: [], edges: [] });
    await workflows.create({
      spaceId: otherSpaceId,
      name: 'Theirs',
      slug: 'theirs',
      source: 'code',
      trigger,
      nodes: [],
      edges: [],
    });

    const missing = randomUUID();
    const bySpace = await workflows.listBySpaces([ctx.spaceId, otherSpaceId, missing]);
    expect(bySpace.get(ctx.spaceId)?.map((row) => row.name)).toEqual(['Alpha', 'Zeta']);
    expect(bySpace.get(otherSpaceId)?.map((row) => row.name)).toEqual(['Theirs']);
    expect(bySpace.get(missing)).toEqual([]);
    expect(await workflows.listBySpaces([])).toEqual(new Map());

    // Matches the single-space read, row for row.
    expect(bySpace.get(ctx.spaceId)).toEqual(await workflows.listBySpace(ctx.spaceId));
    const page = await workflows.pageBySpace(ctx.spaceId, { limit: 1, offset: 1 });
    expect(page).toMatchObject({ total: 2, limit: 1, offset: 1 });
    expect(page.items).toEqual(bySpace.get(ctx.spaceId)?.slice(1));
  });

  it('lists credentials per space in one pass, by name', async () => {
    const { credentials } = ctx.repos;
    await credentials.create({
      spaceId: ctx.spaceId,
      name: 'Shop key',
      slug: 'shop',
      kind: 'apiKey',
    });
    await credentials.create({
      spaceId: ctx.spaceId,
      name: 'Bank key',
      slug: 'bank',
      kind: 'apiKey',
    });
    await credentials.create({
      spaceId: otherSpaceId,
      name: 'Other key',
      slug: 'other',
      kind: 'apiKey',
    });

    const bySpace = await credentials.listBySpaces([ctx.spaceId, otherSpaceId]);
    expect(bySpace.get(ctx.spaceId)?.map((row) => row.slug)).toEqual(['bank', 'shop']);
    expect(bySpace.get(otherSpaceId)?.map((row) => row.slug)).toEqual(['other']);
    expect(bySpace.get(ctx.spaceId)).toEqual(await credentials.listBySpace(ctx.spaceId));

    const first = await credentials.pageBySpace(ctx.spaceId, { limit: 1, offset: 0 });
    expect(first).toMatchObject({ total: 2, limit: 1, offset: 0 });
    expect(first.items.map((row) => row.slug)).toEqual(['bank']);
    const second = await credentials.pageBySpace(ctx.spaceId, { limit: 1, offset: 1 });
    expect(second.items.map((row) => row.slug)).toEqual(['shop']);
  });
});

describe('WorkflowRunRepository.prune', () => {
  it('keeps the newest runs of each workflow and every active run', async () => {
    const { workflows } = repos;
    const workflow = await workflows.create({
      spaceId: ctx.spaceId,
      name: 'Pruned',
      trigger,
      nodes: [],
      edges: [],
    });
    const other = await workflows.create({
      spaceId: ctx.spaceId,
      name: 'Untouched',
      trigger,
      nodes: [],
      edges: [],
    });
    const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes));
    const run = (workflowId: string, status: string, minutes: number) => ({
      workflowId,
      spaceId: ctx.spaceId,
      trigger: 'manual',
      context: {},
      status,
      createdAt: at(minutes),
    });
    const context = databaseContextOf(ctx.repos);
    const { workflowRuns } = workflowTables(context);
    const rows = await context.db
      .insert(workflowRuns)
      .values([
        run(workflow.id, 'waiting', 0),
        run(workflow.id, 'succeeded', 1),
        run(workflow.id, 'failed', 2),
        run(workflow.id, 'succeeded', 3),
        run(workflow.id, 'succeeded', 4),
        run(other.id, 'succeeded', 0),
        run(other.id, 'succeeded', 1),
      ] as never)
      .returning();
    const ids = rows.map((row) => row.id);

    await repos.runs.prune(2);

    const left = async (workflowId: string) =>
      (await context.db.select().from(workflowRuns))
        .filter((row) => row.workflowId === workflowId)
        .map((row) => row.id)
        .sort();
    // The old waiting run survives; the finished ones beyond the newest two go.
    expect(await left(workflow.id)).toEqual([ids[0], ids[3], ids[4]].sort());
    expect(await left(other.id)).toEqual([ids[5], ids[6]].sort());
  });
});

describe('WorkflowRepository live triggers', () => {
  const schedule = {
    kind: 'schedule' as const,
    cron: '* * * * *',
    timezone: 'UTC',
    selection: null,
    perDocument: false,
  };
  const node = { id: 'n1', key: 'a' } as never;

  it('lists enabled published workflows by trigger kind, without graphs', async () => {
    const { workflows } = repos;
    const changed: string[] = [];
    const stop = workflows.onLiveChange((spaceId) => changed.push(spaceId));
    const live = await workflows.create({
      spaceId: otherSpaceId,
      name: 'Nightly',
      enabled: true,
      trigger: schedule,
      nodes: [node],
      edges: [],
    });
    const snapshot = {
      name: 'Nightly',
      description: null,
      trigger: schedule,
      abortTriggers: [],
      nodes: [node],
      edges: [],
    };
    expect(await workflows.listLive({ spaceId: otherSpaceId })).toEqual([]);
    await workflows.publish(live.id, { definition: snapshot });
    expect(changed).toEqual([otherSpaceId]);

    // A draft change of trigger stays out of dispatch until published.
    await workflows.update(live.id, { trigger });
    expect(changed).toEqual([otherSpaceId]);
    const [row] = await workflows.listLive({ spaceId: otherSpaceId, kinds: ['schedule'] });
    expect(row).toEqual({
      id: live.id,
      spaceId: otherSpaceId,
      environmentId: live.environmentId,
      name: 'Nightly',
      enabled: true,
      publishedVersion: 1,
      trigger: schedule,
      abortTriggers: [],
    });
    expect(await workflows.listLive({ spaceId: otherSpaceId, kinds: ['event'] })).toEqual([]);
    expect((await workflows.listLive({ kinds: ['schedule'] })).map((entry) => entry.id)).toContain(
      live.id,
    );

    await workflows.publish(live.id, { definition: { ...snapshot, trigger } });
    expect(await workflows.listLive({ spaceId: otherSpaceId, kinds: ['schedule'] })).toEqual([]);

    await workflows.update(live.id, { enabled: false });
    expect(await workflows.listLive({ spaceId: otherSpaceId })).toEqual([]);
    await workflows.delete(live.id);
    expect(changed).toEqual([otherSpaceId, otherSpaceId, otherSpaceId, otherSpaceId]);
    stop();
  });

  it('leaves out the workflows of a space whose import has not finished', async () => {
    const { workflows } = repos;
    const { spaces } = ctx.repos;
    const importing = await spaces.create(
      { name: 'Arriving', machineName: 'arriving', url: 'http://a.test' },
      { status: 'importing', progress: null as never },
    );
    const snapshot = {
      name: 'Hidden',
      description: null,
      trigger: schedule,
      abortTriggers: [],
      nodes: [node],
      edges: [],
    };
    const row = await workflows.create({ spaceId: importing.id, ...snapshot, enabled: true });
    await workflows.publish(row.id, { definition: snapshot });
    expect(await workflows.listLive({ spaceId: importing.id })).toEqual([]);
    expect((await workflows.listLive({ kinds: ['schedule'] })).map((e) => e.id)).not.toContain(
      row.id,
    );

    await spaces.setImport(importing.id, null, null);
    expect((await workflows.listLive({ spaceId: importing.id })).map((e) => e.id)).toEqual([
      row.id,
    ]);
    await spaces.delete(importing.id);
  });

  it('pages versions with their node counts', async () => {
    const { workflows } = repos;
    const wf = await workflows.create({
      spaceId: ctx.spaceId,
      name: 'Versioned',
      trigger,
      nodes: [],
      edges: [],
    });
    const definition = {
      name: 'Versioned',
      description: null,
      trigger,
      abortTriggers: [],
      nodes: [],
      edges: [],
    };
    await workflows.publish(wf.id, { definition });
    await workflows.publish(wf.id, { definition: { ...definition, nodes: [node, node] } });
    await workflows.publish(wf.id, { definition: { ...definition, nodes: [node] }, note: 'one' });

    const first = await workflows.pageVersions(wf.id, { limit: 2, offset: 0 });
    expect(first.total).toBe(3);
    expect(first.items.map((row) => [row.version, row.nodeCount, row.note])).toEqual([
      [3, 1, 'one'],
      [2, 2, null],
    ]);
    expect(first.items[0]).not.toHaveProperty('nodes');
    const rest = await workflows.pageVersions(wf.id, { limit: 2, offset: 2 });
    expect(rest.items.map((row) => row.nodeCount)).toEqual([0]);
  });
});

describe('WorkflowRunRepository summaries', () => {
  const context = (extra: Record<string, unknown>) =>
    ({ content: null, documents: [], ...extra }) as never;

  it('keeps the history columns in step with the context and log', async () => {
    const { workflows, runs: workflowRuns } = repos;
    const wf = await workflows.create({
      spaceId: ctx.spaceId,
      name: 'Summarised',
      trigger,
      nodes: [],
      edges: [],
    });
    const run = await workflowRuns.create({
      workflowId: wf.id,
      spaceId: ctx.spaceId,
      trigger: 'call',
      context: context({
        content: { id: 'doc-1', title: 'Hello' },
        documents: [{}, {}],
        caller: { workflowId: 'w', workflowName: 'Caller', runId: 'r', nodeKey: 'k', chain: [] },
      }),
    });
    expect(run).toMatchObject({
      documentId: 'doc-1',
      documentTitle: 'Hello',
      documentCount: 2,
      caller: { workflowId: 'w', workflowName: 'Caller', runId: 'r' },
      stepCount: 0,
      failedStep: null,
    });

    const log = [
      { key: 'a', name: 'First', status: 'ok' },
      { key: 'b', name: 'Second', status: 'failed' },
      { key: 'c', name: '', status: 'failed' },
    ] as never;
    await workflowRuns.claim(run.id);
    await workflowRuns.saveProgress(run.id, {
      status: 'failed',
      state: run.state,
      log,
      error: {
        message: 'Item 2: nope',
        key: 'plugins.workflows.run.loopItemFailed',
        params: { item: 2 },
      },
      finished: true,
    });
    const page = await workflowRuns.pageSummariesByWorkflow(wf.id);
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      id: run.id,
      status: 'failed',
      stepCount: 3,
      failedStep: { key: 'b', name: 'Second' },
      error: 'Item 2: nope',
      errorKey: 'plugins.workflows.run.loopItemFailed',
      errorParams: { item: 2 },
    });
    for (const heavy of ['context', 'state', 'log', 'definition']) {
      expect(page.items[0]).not.toHaveProperty(heavy);
    }
  });

  it('aborts in one statement, reporting the status it left', async () => {
    const { workflows, runs: workflowRuns } = repos;
    const wf = await workflows.create({
      spaceId: ctx.spaceId,
      name: 'Stop',
      trigger,
      nodes: [],
      edges: [],
    });
    const run = await workflowRuns.create({
      workflowId: wf.id,
      spaceId: ctx.spaceId,
      trigger: 'manual',
      context: context({}),
    });
    await workflowRuns.claim(run.id);
    await workflowRuns.saveProgress(run.id, {
      status: 'waiting',
      state: run.state,
      log: [],
      resumeAt: new Date(Date.now() - 1000),
    });
    expect((await workflowRuns.listDue(new Date())).map((row) => row.id)).toContain(run.id);

    const abort = {
      source: 'api' as const,
      triggerId: null,
      event: null,
      actor: 'me',
      reason: null,
      at: new Date().toISOString(),
    };
    expect(await workflowRuns.abort(run.id, abort)).toBe('waiting');
    expect(await workflowRuns.abort(run.id, abort)).toBeNull();
    const stored = await workflowRuns.findById(run.id);
    expect(stored).toMatchObject({
      status: 'aborted',
      resumeAt: null,
      abort: { ...abort, from: 'waiting' },
    });
    expect((await workflowRuns.listDue(new Date())).map((row) => row.id)).not.toContain(run.id);
  });
});

describe('WorkflowRunRepository transitions', () => {
  const STATUSES: WorkflowRunStatus[] = [
    'queued',
    'running',
    'waiting',
    'succeeded',
    'failed',
    'skipped',
    'aborted',
  ];
  const abort = {
    source: 'api' as const,
    triggerId: null,
    event: null,
    actor: 'me',
    reason: null,
    at: new Date().toISOString(),
  };
  let workflowId = '';

  beforeAll(async () => {
    const wf = await repos.workflows.create({
      spaceId: ctx.spaceId,
      name: 'Transitions',
      trigger,
      nodes: [],
      edges: [],
    });
    workflowId = wf.id;
  });

  /** A run brought to `status` along allowed transitions. */
  async function runIn(status: WorkflowRunStatus): Promise<string> {
    const { runs: workflowRuns } = repos;
    const run = await workflowRuns.create({
      workflowId,
      spaceId: ctx.spaceId,
      trigger: 'manual',
      context: { content: null, documents: [] } as never,
    });
    if (status === 'queued') return run.id;
    if (status === 'aborted') {
      await workflowRuns.abort(run.id, abort);
      return run.id;
    }
    await workflowRuns.claim(run.id);
    if (status !== 'running') {
      await workflowRuns.saveProgress(run.id, { status, state: run.state, log: [] });
    }
    return run.id;
  }

  /** Tries the move with the method that makes it; whether the stored status changed. */
  async function move(id: string, to: WorkflowRunStatus): Promise<boolean> {
    const { runs: workflowRuns } = repos;
    if (to === 'running') return (await workflowRuns.claim(id)) !== null;
    if (to === 'aborted') return (await workflowRuns.abort(id, abort)) !== null;
    const state = { outputs: {}, fired: [], dead: [], ready: [], done: [] };
    return workflowRuns.saveProgress(id, { status: to, state, log: [] });
  }

  for (const from of STATUSES) {
    for (const to of STATUSES) {
      // A run is only ever created queued.
      if (to === 'queued') continue;
      const allowed = canMoveRun(from, to);
      it(`${allowed ? 'allows' : 'refuses'} ${from} -> ${to}`, async () => {
        const id = await runIn(from);
        expect(await repos.runs.findStatus(id)).toBe(from);
        expect(await move(id, to)).toBe(allowed);
        expect(await repos.runs.findStatus(id)).toBe(allowed ? to : from);
      });
    }
  }

  it('writes the log of an aborted run only', async () => {
    const { runs: workflowRuns } = repos;
    const state = { outputs: {}, fired: [], dead: [], ready: [], done: ['x'] };
    const log = [{ key: 'x', name: 'X', status: 'ok' }] as never;
    const running = await runIn('running');
    await workflowRuns.saveLog(running, state, log);
    expect((await workflowRuns.findById(running))?.stepCount).toBe(0);
    const aborted = await runIn('aborted');
    await workflowRuns.saveLog(aborted, state, log);
    expect(await workflowRuns.findById(aborted)).toMatchObject({ status: 'aborted', stepCount: 1 });
  });
});
