import type { Manablox } from '@manablox/core/node';
import { AuditRepository, type Repositories } from '@manablox/db';
import { CredentialService } from '@manablox/services';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { WorkflowGraph, WorkflowNode, WorkflowTrigger } from '../src/sdk.js';
import { WORKFLOW_LOG_OUTPUT_LIMIT } from '../src/sdk.js';
import { WorkflowRepository, workflowRepos } from '../src/server/db/index.js';
import type { WorkflowEngine } from '../src/server/engine/index.js';
import type { WorkflowService } from '../src/server/services/workflow.service.js';
import { action, call, called, chain, delay, onCreated, shape } from './helpers/graph.js';
import { createWorkflowHarness, START, type WorkflowHarness } from './helpers/harness.js';

let h: WorkflowHarness;
let manablox: Manablox;
let repos: Repositories;
let engine: WorkflowEngine;
let service: WorkflowService;
let spaceId: string;
let page: WorkflowHarness['page'];
let runsOf: WorkflowHarness['runsOf'];

/** A switched-on draft, never published. */
const draft = (name: string, trigger: WorkflowTrigger, graph: WorkflowGraph) =>
  service.create(spaceId, { name, trigger, ...graph, enabled: true });

beforeAll(async () => {
  h = await createWorkflowHarness('workflow-versions');
  ({ manablox, repos, engine, service, spaceId, page, runsOf } = h);
});

afterAll(async () => {
  await h?.close();
});

describe('publishing', () => {
  it('runs nothing until published, then the published version', async () => {
    const wf = await draft('Greeter', onCreated, chain(shape('hello', '{ "v": 1 }')));
    expect(wf.publishedVersion).toBeNull();
    await page('Before publishing');
    await engine.idle();
    expect(await runsOf(wf.id)).toHaveLength(0);

    const { workflow, version } = await service.publish(spaceId, wf.id, '  First cut  ');
    expect(version).toMatchObject({ version: 1, note: 'First cut', name: 'Greeter' });
    expect(workflow).toMatchObject({ publishedVersion: 1, draftChanged: false });

    await page('After publishing');
    await engine.idle();
    const [run] = await runsOf(wf.id);
    expect(run).toMatchObject({ status: 'succeeded', version: 1, test: false, definition: null });
  });

  it('keeps running the published version while the draft changes', async () => {
    const node = shape('answer', '{ "v": 1 }');
    const wf = await service.create(
      spaceId,
      { name: 'Answer', trigger: onCreated, ...chain(node), enabled: true },
      { publish: true },
    );
    const changed = await service.update(spaceId, wf.id, {
      name: 'Answer',
      trigger: onCreated,
      nodes: [{ ...node, config: { template: '{ "v": 2 }' } } as WorkflowNode],
      edges: wf.edges,
      enabled: true,
    });
    expect(changed.draftChanged).toBe(true);

    await page('Draft pending');
    await engine.idle();
    let [run] = await runsOf(wf.id);
    expect(run?.state.outputs.answer?.value).toEqual({ v: 1 });

    const { workflow } = await service.publish(spaceId, wf.id);
    expect(workflow).toMatchObject({ publishedVersion: 2, draftChanged: false });
    await page('Draft published');
    await engine.idle();
    [run] = await runsOf(wf.id);
    expect(run).toMatchObject({ version: 2 });
    expect(run?.state.outputs.answer?.value).toEqual({ v: 2 });

    const { items: versions, total } = await service.versions(spaceId, wf.id);
    expect(total).toBe(2);
    expect(versions.map((entry) => [entry.version, entry.live, entry.nodes])).toEqual([
      [2, true, 1],
      [1, false, 1],
    ]);
    expect(versions[0]?.publishedBy?.kind).toBe('system');
  });

  it('saving what is published again clears the changed flag', async () => {
    const graph = chain(shape('same', '{ "v": 1 }'));
    const input = { name: 'Same', trigger: onCreated, ...graph, enabled: true };
    const wf = await service.create(spaceId, input, { publish: true });
    const renamed = await service.update(spaceId, wf.id, { ...input, name: 'Same, renamed' });
    expect(renamed.draftChanged).toBe(true);
    const back = await service.update(spaceId, wf.id, input);
    expect(back.draftChanged).toBe(false);
  });

  it('publishes on save when asked, with the note', async () => {
    const wf = await draft('Saved live', onCreated, chain(shape('x', '{ "x": 1 }')));
    const saved = await service.update(
      spaceId,
      wf.id,
      { name: 'Saved live', trigger: onCreated, nodes: wf.nodes, edges: wf.edges },
      { publish: true, note: 'Straight out' },
    );
    expect(saved.publishedVersion).toBe(1);
    expect((await service.version(spaceId, wf.id, 1)).note).toBe('Straight out');
  });

  it('resumes a paused run on the version it started on', async () => {
    const hold = delay('hold');
    const after = shape('after', '{ "v": 1 }');
    const wf = await service.create(
      spaceId,
      { name: 'Paused', trigger: onCreated, ...chain(hold, after), enabled: true },
      { publish: true },
    );
    await page('Paused page');
    await engine.idle();
    expect((await runsOf(wf.id))[0]?.status).toBe('waiting');

    await service.update(
      spaceId,
      wf.id,
      {
        name: 'Paused',
        trigger: onCreated,
        nodes: [hold, { ...after, config: { template: '{ "v": 2 }' } } as WorkflowNode],
        edges: wf.edges,
        enabled: true,
      },
      { publish: true },
    );
    await engine.tick(new Date(START.getTime() + 31 * 60_000));
    await engine.idle();
    const [run] = await runsOf(wf.id);
    expect(run).toMatchObject({ status: 'succeeded', version: 1 });
    expect(run?.state.outputs.after?.value).toEqual({ v: 1 });
  });

  it('restores a version into the draft without publishing it', async () => {
    const node = shape('pick', '{ "v": 1 }');
    const input = { name: 'Restore me', trigger: onCreated, ...chain(node), enabled: true };
    const wf = await service.create(spaceId, input, { publish: true });
    await service.update(
      spaceId,
      wf.id,
      { ...input, nodes: [{ ...node, config: { template: '{ "v": 2 }' } } as WorkflowNode] },
      { publish: true },
    );

    const restored = await service.restoreVersion(spaceId, wf.id, 1);
    expect(restored).toMatchObject({ publishedVersion: 2, draftChanged: true });
    expect((restored.nodes[0] as { config: unknown }).config).toEqual({ template: '{ "v": 1 }' });

    await expect(service.version(spaceId, wf.id, 9)).rejects.toMatchObject({
      key: 'plugins.workflows.version.notFound',
    });
    // Code rows are read-only, restores included.
    await workflowRepos(repos).workflows.update(wf.id, { source: 'code' });
    await expect(service.restoreVersion(spaceId, wf.id, 1)).rejects.toMatchObject({
      key: 'plugins.workflows.code.immutable',
    });
    await workflowRepos(repos).workflows.update(wf.id, { source: 'runtime' });
  });

  it('exports a version as well as the draft', async () => {
    const node = shape('ship', '{ "v": 1 }');
    const input = { name: 'Exported', trigger: onCreated, ...chain(node), enabled: true };
    const wf = await service.create(spaceId, input, { publish: true });
    await service.update(spaceId, wf.id, { ...input, name: 'Exported, edited' });
    expect((await service.export(spaceId, wf.id)).workflow.name).toBe('Exported, edited');
    expect((await service.export(spaceId, wf.id, 1)).workflow.name).toBe('Exported');
  });
});

describe('test runs', () => {
  it('runs the unpublished draft and keeps it with the run', async () => {
    const wf = await draft('Draft only', called(), chain(shape('echo', '{ "hi": "there" }')));
    const run = await service.runNow(spaceId, wf.id);
    expect(run).toMatchObject({ status: 'succeeded', test: true, version: null });
    expect(run.definition?.nodes.map((node) => node.key)).toEqual(['echo']);
    expect(run.log[0]).toMatchObject({ key: 'echo', status: 'ok', output: { hi: 'there' } });

    // The draft changes; the run keeps what it ran.
    await service.update(spaceId, wf.id, {
      name: 'Draft only',
      trigger: called(),
      ...chain(shape('other', '{}')),
    });
    const detail = await service.run(spaceId, run.id);
    expect(detail.definition?.nodes.map((node) => node.key)).toEqual(['echo']);
  });

  it('cuts a large output in the log', async () => {
    const big = 'x'.repeat(WORKFLOW_LOG_OUTPUT_LIMIT + 100);
    const wf = await draft('Big', called(), chain(shape('big', `{ "text": "${big}" }`)));
    const run = await service.runNow(spaceId, wf.id);
    const [entry] = run.log;
    expect(entry?.outputTruncated).toBe(true);
    expect(typeof entry?.output).toBe('string');
    expect((entry?.output as string).length).toBe(WORKFLOW_LOG_OUTPUT_LIMIT);
    // The next node still gets all of it.
    expect((run.state.outputs.big?.value as { text: string }).text).toHaveLength(big.length);
  });

  it('calls only published workflows, and marks their runs as tests', async () => {
    const sub = await draft('Unpublished sub', called(), chain(shape('s', '{}')));
    const parent = await draft('Caller', called(), chain(call('go', sub.id)));
    let run = await service.runNow(spaceId, parent.id);
    expect(run.status).toBe('failed');
    expect(run.error).toContain('"Unpublished sub" is not published');

    await service.publish(spaceId, sub.id);
    run = await service.runNow(spaceId, parent.id);
    expect(run.status).toBe('succeeded');
    const [subRun] = await runsOf(sub.id);
    expect(subRun).toMatchObject({ test: true, version: 1 });
  });
});

describe('run history', () => {
  it('pages and filters runs, summarising each', async () => {
    const wf = await service.create(
      spaceId,
      { name: 'History', trigger: onCreated, ...chain(shape('h', '{}')), enabled: true },
      { publish: true },
    );
    await page('History one');
    await page('History two');
    await engine.idle();
    await service.runNow(spaceId, wf.id, { contentId: (await page('History three')).id });
    await engine.idle();

    const all = await service.runHistory(spaceId, wf.id, {}, { limit: 2, offset: 0 });
    // Three from the event, one test run.
    expect(all.total).toBe(4);
    expect(all.items).toHaveLength(2);
    expect(all.items[0]).toMatchObject({ test: true, steps: 1, failedStep: null });
    expect(all.items[0]?.document?.title).toBe('History three');
    expect('context' in (all.items[0] as object)).toBe(false);

    const tests = await service.runHistory(
      spaceId,
      wf.id,
      { test: true },
      { limit: 10, offset: 0 },
    );
    expect(tests.total).toBe(1);
    const live = await service.runHistory(
      spaceId,
      wf.id,
      { test: false },
      { limit: 10, offset: 0 },
    );
    expect(live.items.every((item) => item.version === 1)).toBe(true);
    const failed = await service.runHistory(
      spaceId,
      wf.id,
      { status: ['failed'] },
      { limit: 10, offset: 0 },
    );
    expect(failed.total).toBe(0);
  });

  it('fills in the version a live run walked', async () => {
    const wf = await service.create(
      spaceId,
      { name: 'Detail', trigger: onCreated, ...chain(shape('d', '{}')), enabled: true },
      { publish: true },
    );
    await page('Detail page');
    await engine.idle();
    const [run] = await runsOf(wf.id);
    const detail = await service.run(spaceId, run?.id as string);
    expect(detail.definition?.nodes.map((node) => node.key)).toEqual(['d']);
    expect(detail.definition?.name).toBe('Detail');
  });
});

describe('all-or-nothing writes', () => {
  it('keeps the draft when publishing on save fails', async () => {
    const wf = await draft('Atomic', onCreated, chain(shape('a', '{ "v": 1 }')));
    const heard: string[] = [];
    const off = workflowRepos(repos).workflows.onLiveChange((id) => heard.push(id));
    const failing = vi
      .spyOn(WorkflowRepository.prototype, 'publish')
      .mockRejectedValueOnce(new Error('midway'));
    try {
      await expect(
        service.update(
          spaceId,
          wf.id,
          {
            name: 'Atomic v2',
            trigger: onCreated,
            ...chain(shape('b', '{ "v": 2 }')),
            enabled: true,
          },
          { publish: true },
        ),
      ).rejects.toThrow('midway');
    } finally {
      failing.mockRestore();
      off();
    }
    const after = await service.get(spaceId, wf.id);
    expect(after).toMatchObject({ name: 'Atomic', publishedVersion: null });
    expect(after.nodes.map((node) => node.key)).toEqual(['a']);
    expect((await workflowRepos(repos).workflows.pageVersions(wf.id)).total).toBe(0);
    expect(heard).toEqual([]);

    // Succeeds as a whole, telling live listeners once committed.
    const off2 = workflowRepos(repos).workflows.onLiveChange((id) => heard.push(id));
    try {
      const saved = await service.update(
        spaceId,
        wf.id,
        {
          name: 'Atomic v2',
          trigger: onCreated,
          ...chain(shape('b', '{ "v": 2 }')),
          enabled: true,
        },
        { publish: true },
      );
      expect(saved).toMatchObject({ name: 'Atomic v2', publishedVersion: 1 });
      expect(new Set(heard)).toEqual(new Set([spaceId]));
    } finally {
      off2();
    }
  });

  it('keeps workflows and credentials when their audit entry fails', async () => {
    const credentials = new CredentialService(manablox, repos);
    const secret = await credentials.create(spaceId, {
      name: 'Audited signing',
      kind: 'signing',
      data: { secret: 'shh' },
    });
    const wf = await draft('Audited', onCreated, chain(shape('a', '{ "v": 1 }')));
    const entries = await repos.audit.count({});

    const failNext = () =>
      vi.spyOn(AuditRepository.prototype, 'record').mockRejectedValueOnce(new Error('midway'));
    const attempts: Array<() => Promise<unknown>> = [
      () => service.setEnabled(spaceId, wf.id, false),
      () => service.duplicate(spaceId, wf.id),
      () =>
        service.update(spaceId, wf.id, {
          name: 'Audited v2',
          trigger: onCreated,
          ...chain(shape('a', '{ "v": 1 }')),
          enabled: true,
        }),
      () => service.delete(spaceId, wf.id),
      () => credentials.update(spaceId, secret.id, { name: 'Renamed', kind: 'signing', data: {} }),
      () => credentials.delete(spaceId, secret.id),
    ];
    for (const attempt of attempts) {
      const spy = failNext();
      try {
        await expect(attempt()).rejects.toThrow('midway');
      } finally {
        spy.mockRestore();
      }
    }

    expect(await service.get(spaceId, wf.id)).toMatchObject({ name: 'Audited', enabled: true });
    expect(
      (await workflowRepos(repos).workflows.listBySpace(spaceId)).filter((row) =>
        row.name.startsWith('Audited'),
      ),
    ).toHaveLength(1);
    expect(await credentials.get(spaceId, secret.id)).toMatchObject({ name: 'Audited signing' });
    expect(await repos.audit.count({})).toBe(entries);
  });

  it('creates no credential when an import fails midway', async () => {
    const credentials = new CredentialService(manablox, repos);
    const secret = await credentials.create(spaceId, {
      name: 'Atomic token',
      kind: 'bearer',
      data: { token: 'shh' },
    });
    const wf = await draft(
      'Atomic import',
      onCreated,
      chain(
        action(
          'a',
          'http',
          { method: 'POST', url: 'https://atomic.test' },
          {
            credentialId: secret.id,
          },
        ),
      ),
    );
    const file = JSON.parse(JSON.stringify(await service.export(spaceId, wf.id)));
    const other = await repos.spaces.create({
      name: 'Atomic',
      machineName: 'atomic-import',
      url: 'https://atomic.test',
    });

    const failing = vi
      .spyOn(WorkflowRepository.prototype, 'create')
      .mockRejectedValueOnce(new Error('midway'));
    try {
      await expect(service.import(other.id, file)).rejects.toThrow('midway');
    } finally {
      failing.mockRestore();
    }
    expect(await repos.credentials.listBySpace(other.id)).toEqual([]);
    expect(await workflowRepos(repos).workflows.listBySpace(other.id)).toEqual([]);

    const { workflow } = await service.import(other.id, file);
    expect(workflow.name).toBe('Atomic import');
    expect(await repos.credentials.listBySpace(other.id)).toHaveLength(1);
  });
});
