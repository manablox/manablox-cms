import { RunError } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories } from '@manablox/db';
import type { ContentService } from '@manablox/services';
import { CredentialService } from '@manablox/services';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineWorkflowAction } from '../src/define/action.js';
import type { WorkflowAbortTrigger, WorkflowNode } from '../src/sdk.js';
import { canMoveRun, runStatusesInto, WORKFLOW_TRIGGER_ID } from '../src/sdk.js';
import { workflowRepos } from '../src/server/db/index.js';
import type { WorkflowEngine } from '../src/server/engine/index.js';
import type { WorkflowRunSummary } from '../src/server/hooks.js';
import type { WorkflowService } from '../src/server/services/workflow.service.js';
import { readWorkflowFile } from '../src/server/transfer/index.js';
import { ABORT_CHECK_MS } from '../src/server/walker/index.js';
import { abortOn, action, base, chain, delay, edge, onCreated } from './helpers/graph.js';
import { createWorkflowHarness, START, type WorkflowHarness } from './helpers/harness.js';

let h: WorkflowHarness;
let manablox: Manablox;
let repos: Repositories;
let content: ContentService;
let engine: WorkflowEngine;
let service: WorkflowService;
let spaceId: string;
let pageType: string;
let workflow: WorkflowHarness['workflow'];
let page: WorkflowHarness['page'];
let runsOf: WorkflowHarness['runsOf'];

const finished: WorkflowRunSummary[] = [];
const blocked: string[] = [];
let release: (() => void) | null = null;
let entered: Promise<void> = Promise.resolve();

const wait = (key: string, minutes = 60) => delay(key, minutes);
const note = (key: string) => action(key, 'test.note');
const block = (key: string) => action(key, 'test.block');

beforeAll(async () => {
  h = await createWorkflowHarness('workflow-abort');
  ({ manablox, repos, content, engine, service, spaceId, pageType, workflow, page, runsOf } = h);

  h.registry.actions.register(
    defineWorkflowAction({
      type: 'test.note',
      label: 'Note',
      description: '',
      icon: 'bug',
      tone: 'plain',
      group: 'data',
      inputs: [],
      ports: [],
      output: { name: 'ok', label: 'Out', type: 'json' },
      outputPaths: [],
      credential: null,
      fields: [],
      defaults: () => ({}),
      execute: async (ctx) => ({
        kind: 'ok',
        output: { order: ctx.render('{{ content.title }}') },
      }),
    }),
  );
  h.registry.actions.register(
    defineWorkflowAction({
      type: 'test.block',
      label: 'Block',
      description: '',
      icon: 'bug',
      tone: 'plain',
      group: 'data',
      inputs: [],
      ports: [],
      output: { name: 'ok', label: 'Out', type: 'json' },
      outputPaths: [],
      credential: null,
      fields: [],
      defaults: () => ({}),
      // Holds until released, or until the run's signal aborts.
      execute: (ctx) =>
        new Promise((resolve, reject) => {
          blocked.push(ctx.node.key);
          release = () => resolve({ kind: 'ok', output: { released: true } });
          ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true });
        }),
    }),
  );

  manablox.hooks.on('workflows:afterRun', (summary) => {
    finished.push(summary);
  });
});

afterAll(async () => {
  await h?.close();
});

beforeEach(async () => {
  finished.length = 0;
  blocked.length = 0;
  release = null;
  for (const row of await workflowRepos(repos).workflows.listBySpace(spaceId)) {
    await workflowRepos(repos).workflows.delete(row.id);
  }
});

/** Starts a blocking run and resolves once its action is holding. */
async function blockingRun(name: string, abortTriggers: WorkflowAbortTrigger[] = []) {
  const wf = await workflow(name, onCreated, chain(block('hold'), note('after')), {
    abortTriggers,
  });
  entered = new Promise<void>((resolve) => {
    const poll = () => (blocked.length ? resolve() : setTimeout(poll, 5));
    poll();
  });
  await page(`${name} page`);
  await entered;
  return wf;
}

describe('abort triggers on events', () => {
  it('aborts a waiting run about the same document and leaves the others', async () => {
    const wf = await workflow('Remind', onCreated, chain(wait('later'), note('remind')), {
      abortTriggers: [abortOn(['content.deleted'], { mode: 'document' })],
    });
    const first = await page('First');
    await page('Second');
    await engine.idle();
    expect((await runsOf(wf.id)).map((run) => run.status)).toEqual(['waiting', 'waiting']);

    await content.delete(spaceId, first.id);
    await engine.idle();

    const runs = await runsOf(wf.id);
    const byDoc = (id: string) =>
      runs.find((run) => (run.context.content as { id: string }).id === id);
    expect(byDoc(first.id)?.status).toBe('aborted');
    expect(byDoc(first.id)?.abort).toMatchObject({ source: 'event', event: 'content.deleted' });
    expect(runs.filter((run) => run.status === 'waiting')).toHaveLength(1);
    expect(finished.filter((entry) => entry.status === 'aborted')).toHaveLength(1);

    // An aborted run never resumes.
    await engine.tick(new Date('2026-09-06T16:00:00.000Z'));
    await engine.idle();
    expect(byDoc(first.id)?.log.map((entry) => entry.key)).toEqual(['later']);
    expect((await workflowRepos(repos).runs.findById(byDoc(first.id)?.id ?? ''))?.status).toBe(
      'aborted',
    );

    const audit = await repos.audit.pageByTarget({
      kind: 'workflows.run',
      id: byDoc(first.id)?.id ?? '',
    });
    expect(audit.items.map((entry) => entry.action)).toContain('workflows.run.abort');
  });

  it('aborts before starting, so one event replaces the earlier run', async () => {
    const wf = await workflow(
      'Debounce',
      { kind: 'event', events: ['content.saved'], typeIds: [], locales: [] },
      chain(wait('settle'), note('act')),
      { abortTriggers: [abortOn(['content.saved'], { mode: 'document' })] },
    );
    const doc = await page('Draft');
    await engine.idle();
    await content.update(spaceId, doc.id, {
      spaceId,
      typeId: pageType,
      locale: 'en',
      title: 'Draft 2',
      slug: 'draft',
      fields: {},
    });
    await engine.idle();

    const statuses = (await runsOf(wf.id)).map((run) => run.status);
    expect(statuses.sort()).toEqual(['aborted', 'waiting']);
  });

  it('aborts on another workflow finishing, picked by a filter', async () => {
    const waiting = await workflow('Wait for the other', onCreated, chain(wait('hold')));
    const other = await workflow('Other', onCreated, chain(note('done')));
    await service.update(
      spaceId,
      waiting.id,
      {
        name: waiting.name,
        trigger: onCreated,
        nodes: waiting.nodes,
        edges: waiting.edges,
        enabled: true,
        abortTriggers: [
          abortOn(
            ['workflow.finished'],
            {},
            {
              filter: {
                match: 'all',
                rules: [
                  { field: 'data.workflowId', operator: 'equals', value: other.id },
                  { field: 'data.status', operator: 'equals', value: 'succeeded' },
                ],
              },
            },
          ),
        ],
      },
      { publish: true },
    );

    await page('Both');
    await engine.idle();

    expect((await runsOf(other.id))[0]?.status).toBe('succeeded');
    expect((await runsOf(waiting.id))[0]?.status).toBe('aborted');
  });
});

describe('aborting a running run', () => {
  it('stops the in-flight action and runs nothing after it', async () => {
    const wf = await blockingRun('Stop me');
    const [run] = await runsOf(wf.id);
    expect(run?.status).toBe('running');

    const aborted = await service.abortRun(spaceId, run?.id ?? '', {
      actor: 'ann@example.com',
      reason: 'wrong order',
    });
    await engine.idle();

    expect(aborted.status).toBe('aborted');
    const stored = await workflowRepos(repos).runs.findById(run?.id ?? '');
    expect(stored?.status).toBe('aborted');
    expect(stored?.abort).toMatchObject({
      source: 'api',
      actor: 'ann@example.com',
      reason: 'wrong order',
    });
    expect(stored?.log.map((entry) => [entry.key, entry.status])).toEqual([['hold', 'stopped']]);
    // Reported once, by the abort.
    expect(finished.filter((entry) => entry.runId === run?.id)).toEqual([
      expect.objectContaining({ status: 'aborted' }),
    ]);
  });

  it('notices an abort stored by another process before the next node', async () => {
    const wf = await blockingRun('Elsewhere');
    const [run] = await runsOf(wf.id);
    // Straight to the database, as a second process would.
    await workflowRepos(repos).runs.abort(run?.id ?? '', {
      source: 'api',
      triggerId: null,
      event: null,
      actor: null,
      reason: null,
      at: START.toISOString(),
    });
    release?.();
    await engine.idle();

    const stored = await workflowRepos(repos).runs.findById(run?.id ?? '');
    expect(stored?.status).toBe('aborted');
    expect(stored?.log.map((entry) => entry.key)).toEqual(['hold']);
  });

  it('refuses to abort a run that has ended', async () => {
    const wf = await workflow('Quick', onCreated, chain(note('done')));
    await page('Quick page');
    await engine.idle();
    const [run] = await runsOf(wf.id);
    expect(run?.status).toBe('succeeded');
    await expect(service.abortRun(spaceId, run?.id ?? '', { actor: null })).rejects.toMatchObject({
      key: 'plugins.workflows.run.notActive',
    });
  });

  it('aborts every active run of a workflow', async () => {
    const wf = await workflow('Many', onCreated, chain(wait('hold')));
    await page('One');
    await page('Two');
    await engine.idle();
    const { aborted } = await service.abortRuns(spaceId, wf.id, { actor: null });
    expect(aborted).toHaveLength(2);
    expect((await runsOf(wf.id)).every((run) => run.status === 'aborted')).toBe(true);
  });
});

describe('stored aborts inside a loop', () => {
  /** The trigger, a loop over `items`, and `body` once per item. */
  function looping(items: unknown[], body: WorkflowNode) {
    const loop = {
      ...base('each'),
      kind: 'loop',
      items: JSON.stringify(items),
      maxItems: 500,
    } as WorkflowNode;
    return {
      nodes: [loop, body],
      edges: [edge(WORKFLOW_TRIGGER_ID, loop.id, 'out'), edge(loop.id, body.id, 'each')],
    };
  }

  it('checks the database at most once a second, not once per pass', async () => {
    const items = Array.from({ length: 200 }, (_, index) => index);
    const wf = await workflow('Long loop', onCreated, looping(items, note('tick')));
    const status = vi.spyOn(workflowRepos(repos).runs, 'findStatus');
    try {
      await page('Long loop page');
      await engine.idle();
      const [run] = await runsOf(wf.id);
      expect(run?.status).toBe('succeeded');
      expect(run?.log.filter((entry) => entry.key === 'tick')).toHaveLength(items.length);
      // Before the loop node, then only when a second has passed.
      expect(status.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(status.mock.calls.length).toBeLessThanOrEqual(3);
    } finally {
      status.mockRestore();
    }
  });

  it('still notices an abort stored by another process', async () => {
    const wf = await workflow('Held loop', onCreated, looping([1, 2, 3], block('hold')));
    entered = new Promise<void>((resolve) => {
      const poll = () => (blocked.length ? resolve() : setTimeout(poll, 5));
      poll();
    });
    await page('Held loop page');
    await entered;
    const [run] = await runsOf(wf.id);
    await workflowRepos(repos).runs.abort(run?.id ?? '', {
      source: 'api',
      triggerId: null,
      event: null,
      actor: null,
      reason: null,
      at: START.toISOString(),
    });
    // The next pass starts once the check interval has passed.
    const later = Date.now() + ABORT_CHECK_MS;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => later);
    try {
      release?.();
      await engine.idle();
    } finally {
      now.mockRestore();
    }

    const stored = await workflowRepos(repos).runs.findById(run?.id ?? '');
    expect(stored?.status).toBe('aborted');
    expect(blocked).toEqual(['hold']);
    expect(stored?.log.filter((entry) => entry.key === 'hold')).toHaveLength(1);
  });
});

describe('abort trigger validation', () => {
  it('reports what an abort trigger is missing', async () => {
    await expect(
      workflow('Bad', onCreated, chain(note('a')), {
        abortTriggers: [
          abortOn([], { mode: 'key' }),
          abortOn(['asset.uploaded'], { mode: 'document' }),
          { ...abortOn([]), kind: 'nowhere' } as unknown as WorkflowAbortTrigger,
        ],
      }),
    ).rejects.toMatchObject({
      details: expect.arrayContaining([
        expect.objectContaining({ key: 'plugins.workflows.abort.eventsRequired' }),
        expect.objectContaining({ key: 'plugins.workflows.abort.keyRequired' }),
        expect.objectContaining({ key: 'plugins.workflows.abort.documentNeedsContent' }),
        expect.objectContaining({ key: 'plugins.workflows.abort.kindUnknown' }),
      ]),
    });
  });

  it('gives every abort trigger a stable id', async () => {
    const wf = await workflow('Ids', onCreated, chain(note('a')), {
      abortTriggers: [abortOn(['content.deleted'])],
    });
    const id = wf.abortTriggers[0]?.id;
    expect(id).toBeTruthy();
    const again = await service.update(spaceId, wf.id, {
      name: wf.name,
      trigger: wf.trigger,
      abortTriggers: wf.abortTriggers,
      nodes: wf.nodes,
      edges: wf.edges,
    });
    expect(again.abortTriggers[0]?.id).toBe(id);
  });
});

describe('workflow files', () => {
  it('round-trips a workflow into another space, recreating what it needs', async () => {
    const credentials = new CredentialService(manablox, repos);
    const secret = await credentials.create(spaceId, {
      name: 'Shop token',
      kind: 'bearer',
      data: { token: 'shh-very-secret' },
    });
    const wf = await workflow(
      'Ship orders',
      onCreated,
      chain(
        wait('pack'),
        action(
          'ship',
          'http',
          { method: 'POST', url: 'https://shop.test/ship' },
          {
            credentialId: secret.id,
          },
        ),
      ),
      {
        abortTriggers: [
          abortOn(['content.deleted'], { mode: 'document' }, { typeIds: [pageType] }),
        ],
      },
    );

    const file = await service.export(spaceId, wf.id);
    const json = JSON.parse(JSON.stringify(file));
    expect(JSON.stringify(json)).not.toContain('shh-very-secret');
    expect(json.credentials).toEqual([
      expect.objectContaining({ slug: secret.slug, kind: 'bearer' }),
    ]);

    const other = await repos.spaces.create({
      name: 'Other',
      machineName: 'other-import',
      url: 'https://other.test',
    });
    const { workflow: imported, notes } = await service.import(other.id, json);

    expect(imported.enabled).toBe(false);
    expect(imported.name).toBe('Ship orders');
    expect(imported.nodes.map((node) => node.key)).toEqual(['pack', 'ship']);
    const [slot] = await repos.credentials.listBySpace(other.id);
    expect(slot).toMatchObject({ slug: secret.slug, data: null });
    expect(imported.nodes[1]).toMatchObject({ credentialId: slot?.id });
    // The page type is a code type, so it exists everywhere.
    expect(imported.abortTriggers[0]).toMatchObject({ typeIds: [pageType] });
    expect(notes.length).toBe(1);

    // Importing again reuses the credential by slug, and renames the copy.
    const again = await service.import(other.id, json);
    expect(again.workflow.name).toBe('Ship orders (copy)');
    expect(again.notes).toEqual([]);
    expect(await repos.credentials.listBySpace(other.id)).toHaveLength(1);
  });

  it('refuses files that are not workflow exports', async () => {
    expect(() => readWorkflowFile({ hello: 'world' }, h.registry)).toThrow();
    expect(() =>
      readWorkflowFile({ format: 'manablox.workflow', version: 99, workflow: {} }, h.registry),
    ).toThrowError(expect.objectContaining({ key: 'plugins.workflows.import.versionUnsupported' }));
    await expect(
      service.import(spaceId, { format: 'manablox.workflow', version: 1, workflow: { nodes: [] } }),
    ).rejects.toMatchObject({ key: 'plugins.workflows.import.invalid' });
  });

  it('leaves out a record list no configured trigger kind reads', () => {
    const file = readWorkflowFile(
      {
        format: 'manablox.workflow',
        version: 1,
        workflow: { name: 'x', trigger: { kind: 'event' }, nodes: [], edges: [] },
        webhooks: [{ id: 'w1', slug: 'shop', authMode: 'hmac' }],
      },
      h.registry,
    );
    expect(file.webhooks).toBeUndefined();
  });
});

describe('run lifecycle', () => {
  const endsOf = async (runId: string) =>
    (await repos.audit.pageByTarget({ kind: 'workflows.run', id: runId })).items.map(
      (entry) => entry.action,
    );
  const reportsOf = (runId: string | undefined) =>
    finished.filter((entry) => entry.runId === runId).map((entry) => entry.status);

  it('moves runs only along the transition table', () => {
    expect(runStatusesInto('running')).toEqual(['queued', 'waiting']);
    expect(runStatusesInto('waiting')).toEqual(['running']);
    expect(runStatusesInto('aborted')).toEqual(['queued', 'running', 'waiting']);
    for (const ended of ['succeeded', 'failed', 'skipped', 'aborted'] as const) {
      expect(canMoveRun('running', ended)).toBe(true);
      expect(canMoveRun(ended, 'running')).toBe(false);
    }
    expect(canMoveRun('queued', 'succeeded')).toBe(false);
  });

  it('resumes a paused run and reports it once when it ends', async () => {
    const wf = await workflow('Pause', onCreated, chain(wait('later', 1), note('after')));
    await page('Pause page');
    await engine.idle();
    const [run] = await runsOf(wf.id);
    expect(run?.status).toBe('waiting');
    expect(reportsOf(run?.id)).toEqual([]);

    await engine.tick(new Date(START.getTime() + 2 * 60_000));
    await engine.idle();
    const stored = await workflowRepos(repos).runs.findById(run?.id ?? '');
    expect(stored?.status).toBe('succeeded');
    expect(stored?.log.map((entry) => [entry.key, entry.status])).toEqual([
      ['later', 'waiting'],
      ['after', 'ok'],
    ]);
    expect(reportsOf(run?.id)).toEqual(['succeeded']);
    expect(await endsOf(run?.id ?? '')).toEqual(['workflows.run.finish']);
  });

  it('aborts a paused run, which then never resumes', async () => {
    const wf = await workflow('Pause abort', onCreated, chain(wait('later', 1), note('after')));
    await page('Pause abort page');
    await engine.idle();
    const [run] = await runsOf(wf.id);
    await service.abortRun(spaceId, run?.id ?? '', { actor: null });
    await engine.tick(new Date(START.getTime() + 2 * 60_000));
    await engine.run(run?.id ?? '');
    await engine.idle();

    const stored = await workflowRepos(repos).runs.findById(run?.id ?? '');
    expect(stored).toMatchObject({ status: 'aborted', abort: { from: 'waiting' } });
    expect(stored?.log.map((entry) => entry.key)).toEqual(['later']);
    expect(reportsOf(run?.id)).toEqual(['aborted']);
    expect(await endsOf(run?.id ?? '')).toEqual(['workflows.run.abort']);
  });

  it('keeps an abort that lands while the last node runs, with that node logged', async () => {
    const wf = await workflow('Last node', onCreated, chain(block('hold')));
    entered = new Promise<void>((resolve) => {
      const poll = () => (blocked.length ? resolve() : setTimeout(poll, 5));
      poll();
    });
    await page('Last node page');
    await entered;
    const [run] = await runsOf(wf.id);
    // Another process aborts; this one finishes the node and loses the race to save.
    await workflowRepos(repos).runs.abort(run?.id ?? '', {
      source: 'api',
      triggerId: null,
      event: null,
      actor: null,
      reason: null,
      at: START.toISOString(),
    });
    release?.();
    await engine.idle();

    const stored = await workflowRepos(repos).runs.findById(run?.id ?? '');
    expect(stored?.status).toBe('aborted');
    expect(stored?.log.map((entry) => [entry.key, entry.status])).toEqual([['hold', 'ok']]);
    expect(reportsOf(run?.id)).toEqual([]);
    expect(await endsOf(run?.id ?? '')).toEqual([]);
  });

  it('stores the key and params of a failure beside its English message', async () => {
    h.registry.actions.register(
      defineWorkflowAction({
        type: 'test.fail',
        label: 'Fail',
        description: '',
        icon: 'bug',
        tone: 'plain',
        group: 'data',
        inputs: [],
        ports: [],
        output: { name: 'ok', label: 'Out', type: 'json' },
        outputPaths: [],
        credential: null,
        fields: [],
        defaults: () => ({}),
        execute: async () => {
          throw new RunError(
            'plugins.workflows.run.pageStatus',
            { url: 'https://x.test', status: 502 },
            'https://x.test answered HTTP 502',
          );
        },
      }),
    );
    const fail = { ...note('fail'), action: 'test.fail' } as WorkflowNode;
    const wf = await workflow('Fails', onCreated, chain(fail));
    await page('Fails page');
    await engine.idle();
    const [run] = await runsOf(wf.id);
    const stored = await workflowRepos(repos).runs.findById(run?.id ?? '');
    const params = { url: 'https://x.test', status: 502 };
    expect(stored).toMatchObject({
      status: 'failed',
      error: 'https://x.test answered HTTP 502',
      errorKey: 'plugins.workflows.run.pageStatus',
      errorParams: params,
    });
    expect(stored?.log[0]).toMatchObject({
      status: 'failed',
      message: 'https://x.test answered HTTP 502',
      messageKey: 'plugins.workflows.run.pageStatus',
      messageParams: params,
    });
    expect(reportsOf(run?.id)).toEqual(['failed']);
  });

  it('reports a second abort of the same run as refused', async () => {
    const wf = await workflow('Twice', onCreated, chain(wait('hold')));
    await page('Twice page');
    await engine.idle();
    const [run] = await runsOf(wf.id);
    const target = { id: wf.id, spaceId, name: wf.name };
    const active = await workflowRepos(repos).runs.listActiveByWorkflow(wf.id);
    const abort = {
      source: 'api' as const,
      triggerId: null,
      event: null,
      actor: null,
      reason: null,
      at: START.toISOString(),
    };
    const results = await Promise.all(
      active
        .map((row) => engine.abortRun(target, row, abort))
        .concat(active.map((row) => engine.abortRun(target, row, abort))),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(reportsOf(run?.id)).toEqual(['aborted']);
  });
});
