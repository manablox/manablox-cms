import type { Repositories } from '@manablox/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defineWorkflowAction } from '../src/define/action.js';
import { WORKFLOW_TRIGGER_ID } from '../src/sdk.js';
import { type WorkflowRunRow, workflowRepos } from '../src/server/db/index.js';
import type { WorkflowEngine } from '../src/server/engine/index.js';
import type { WorkflowService } from '../src/server/services/workflow.service.js';
import { action, call, called, chain, delay, edge, onCreated, shape } from './helpers/graph.js';
import { createWorkflowHarness, type WorkflowHarness } from './helpers/harness.js';

let h: WorkflowHarness;
let repos: Repositories;
let engine: WorkflowEngine;
let service: WorkflowService;
let spaceId: string;
let workflow: WorkflowHarness['workflow'];
let page: WorkflowHarness['page'];
let runsOf: WorkflowHarness['runsOf'];

const fail = (key: string) => action(key, 'test.fail');
const outputOf = (run: WorkflowRunRow | undefined, key: string) =>
  run?.state.outputs[key]?.value as { runId: string; status: string; output: unknown };

beforeAll(async () => {
  h = await createWorkflowHarness('workflow-call');
  ({ repos, engine, service, spaceId, workflow, page, runsOf } = h);

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
        throw new Error('the order service is down');
      },
    }),
  );
});

afterAll(async () => {
  await h?.close();
});

beforeEach(async () => {
  await engine.idle();
  for (const row of await workflowRepos(repos).workflows.listBySpace(spaceId)) {
    await workflowRepos(repos).workflows.delete(row.id);
  }
});

describe('calling a workflow', () => {
  it('runs the called workflow through and hands its output on', async () => {
    const sub = await workflow(
      'Total',
      called([{ name: 'amount', required: true }], '{{ nodes.sum }}'),
      chain(shape('sum', '{ "total": "{{ input.amount }}", "about": "{{ content.title }}" }')),
    );
    const parent = await workflow(
      'Order',
      onCreated,
      chain(
        call('total', sub.id, { amount: '{{ content.title }}' }),
        shape('report', '{ "got": "{{ nodes.total.output.total }}" }'),
      ),
    );

    await page('42');
    await engine.idle();

    const [run] = await runsOf(parent.id);
    expect(run?.status).toBe('succeeded');
    const [subRun] = await runsOf(sub.id);
    expect(subRun?.status).toBe('succeeded');
    expect(subRun?.trigger).toBe('call');
    expect(subRun?.context.input).toEqual({ amount: '42' });
    expect(subRun?.context.caller).toMatchObject({
      workflowId: parent.id,
      runId: run?.id,
      nodeKey: 'total',
      wait: true,
      chain: [parent.id],
    });
    expect(outputOf(run, 'total')).toEqual({
      runId: subRun?.id,
      status: 'succeeded',
      output: { total: '42', about: '42' },
    });
    expect(outputOf(run, 'report')).toEqual({ got: '42' });
  });

  it('hands back every node output when the trigger names none', async () => {
    const sub = await workflow('Parts', called(), chain(shape('a', '{ "x": 1 }')));
    const parent = await workflow('Caller', onCreated, chain(call('parts', sub.id)));
    await page('Parts page');
    await engine.idle();
    const [run] = await runsOf(parent.id);
    expect(outputOf(run, 'parts').output).toEqual({ a: { x: 1 } });
  });

  it('takes the error port when the called run fails', async () => {
    const sub = await workflow('Breaks', called(), chain(fail('boom')));
    const node = call('try', sub.id);
    const recover = shape('recover', '{ "handled": true }');
    const parent = await workflow('Careful', onCreated, {
      nodes: [node, recover],
      edges: [edge(WORKFLOW_TRIGGER_ID, node.id, 'out'), edge(node.id, recover.id, 'error')],
    });

    await page('Breaks page');
    await engine.idle();

    const [run] = await runsOf(parent.id);
    expect(run?.status).toBe('succeeded');
    const entry = run?.log.find((line) => line.key === 'try');
    expect(entry?.status).toBe('failed');
    expect(entry?.message).toContain('the order service is down');
    expect(run?.log.map((line) => line.key)).toEqual(['try', 'recover']);
  });

  it('pauses the caller while the called run waits, and resumes it after', async () => {
    const sub = await workflow(
      'Later',
      called([], '{{ nodes.done }}'),
      chain(delay('pause'), shape('done', '{ "ok": true }')),
    );
    const parent = await workflow(
      'Patient',
      onCreated,
      chain(call('later', sub.id), shape('after', '{ "saw": "{{ nodes.later.output.ok }}" }')),
    );

    await page('Patient page');
    await engine.idle();
    let [run] = await runsOf(parent.id);
    expect(run?.status).toBe('waiting');
    expect(run?.resumeAt).toBeNull();
    expect(run?.state.awaiting).toMatchObject({ runId: (await runsOf(sub.id))[0]?.id });

    await engine.tick(new Date('2026-09-06T15:30:00.000Z'));
    await engine.idle();

    [run] = await runsOf(parent.id);
    expect(run?.status).toBe('succeeded');
    expect(run?.state.awaiting).toBeFalsy();
    expect(outputOf(run, 'after')).toEqual({ saw: true });
    expect(run?.log.map((line) => `${line.key}:${line.status}`)).toEqual([
      'later:waiting',
      'later:ok',
      'after:ok',
    ]);
  });

  it('resumes the caller although a workflows:afterRun handler throws', async () => {
    const sub = await workflow(
      'Later again',
      called([], '{{ nodes.done }}'),
      chain(delay('pause'), shape('done', '{ "ok": true }')),
    );
    const parent = await workflow(
      'Still patient',
      onCreated,
      chain(call('later', sub.id), shape('after', '{ "saw": "{{ nodes.later.output.ok }}" }')),
    );
    await page('Still patient page');
    await engine.idle();

    const off = h.manablox.hooks.on('workflows:afterRun', () => {
      throw new Error('the audit sink is down');
    });
    try {
      await engine.tick(new Date('2026-09-06T15:30:00.000Z'));
      await engine.idle();
    } finally {
      off();
    }
    const [run] = await runsOf(parent.id);
    expect(run?.status).toBe('succeeded');
    expect(outputOf(run, 'after')).toEqual({ saw: true });
  });

  it('only starts the called run when told not to wait', async () => {
    const sub = await workflow('Fire', called(), chain(shape('x', '{ "x": 1 }')));
    const parent = await workflow('Forget', onCreated, chain(call('fire', sub.id, {}, false)));
    await page('Forget page');
    await engine.idle();

    const [run] = await runsOf(parent.id);
    expect(run?.status).toBe('succeeded');
    expect(outputOf(run, 'fire')).toMatchObject({ status: 'queued', output: null });
    const [subRun] = await runsOf(sub.id);
    expect(subRun?.status).toBe('succeeded');
    expect(subRun?.context.caller?.wait).toBe(false);
  });

  it('fails a call that leaves out a required value', async () => {
    const sub = await workflow('Needs', called([{ name: 'id' }]), chain(shape('x', '{ "x": 1 }')));
    const parent = await workflow('Gives nothing', onCreated, chain(call('needs', sub.id)));
    // Saved while the parameter was optional, then made required.
    await workflowRepos(repos).workflows.update(sub.id, {
      trigger: called([{ name: 'id', required: true }]),
    });
    await service.publish(spaceId, sub.id);
    await page('Empty page');
    await engine.idle();
    const [run] = await runsOf(parent.id);
    expect(run?.status).toBe('failed');
    expect(run?.error).toContain('needs a value for "id"');
    expect(await runsOf(sub.id)).toHaveLength(0);
  }, 10_000);

  it('refuses a workflow that calls itself round', async () => {
    const a = await workflow('Ping', called(), chain(shape('x', '{ "x": 1 }')));
    const b = await workflow('Pong', called(), chain(call('ping', a.id)));
    await service.update(
      spaceId,
      a.id,
      { name: 'Ping', enabled: true, trigger: called(), ...chain(call('pong', b.id)) },
      { publish: true },
    );

    const run = await service.runNow(spaceId, a.id);
    await engine.idle();
    expect(run.status).toBe('failed');
    const [pong] = await runsOf(b.id);
    expect(pong?.error).toContain('already running further up');
  });

  it('refuses a switched-off workflow at run time', async () => {
    const sub = await workflow('Off', called(), chain(shape('x', '{ "x": 1 }')));
    const parent = await workflow('Calls off', onCreated, chain(call('off', sub.id)));
    await service.setEnabled(spaceId, sub.id, false);
    await page('Off page');
    await engine.idle();
    const [run] = await runsOf(parent.id);
    expect(run?.error).toContain('is switched off');
  });

  it('aborts the called run along with its waiting caller', async () => {
    const sub = await workflow('Slow', called(), chain(delay('pause'), shape('x', '{ "x": 1 }')));
    const parent = await workflow('Waits', onCreated, chain(call('slow', sub.id)));
    await page('Waits page');
    await engine.idle();

    const [run] = await runsOf(parent.id);
    await service.abortRun(spaceId, run?.id ?? '', { actor: 'tester' });
    const [subRun] = await runsOf(sub.id);
    expect(subRun?.status).toBe('aborted');
    expect(subRun?.abort).toMatchObject({ source: 'caller', actor: 'tester' });
  });

  it('fails the waiting caller when the called run is aborted', async () => {
    const sub = await workflow('Stoppable', called(), chain(delay('pause'), shape('x', '{}')));
    const parent = await workflow('Hopes', onCreated, chain(call('stoppable', sub.id)));
    await page('Hopes page');
    await engine.idle();

    const [subRun] = await runsOf(sub.id);
    await service.abortRun(spaceId, subRun?.id ?? '', { actor: 'tester' });
    await engine.idle();
    const [run] = await runsOf(parent.id);
    expect(run?.status).toBe('failed');
    expect(run?.error).toContain('it was aborted');
  });

  it('runs a called workflow by hand with the values given', async () => {
    const sub = await workflow(
      'By hand',
      called([{ name: 'who' }], '{{ input.who }}'),
      chain(shape('x', '{ "x": 1 }')),
    );
    const run = await service.runNow(spaceId, sub.id, { input: { who: 'Ada' } });
    expect(run.status).toBe('succeeded');
    expect(run.context.input).toEqual({ who: 'Ada' });
    expect(run.state.result).toBe('Ada');
  });
});

describe('saving a call node', () => {
  it('refuses a target that cannot be called', async () => {
    const plain = await workflow('Plain', onCreated, chain(shape('x', '{ "x": 1 }')));
    await expect(workflow('Bad', onCreated, chain(call('plain', plain.id)))).rejects.toMatchObject({
      details: [expect.objectContaining({ key: 'plugins.workflows.call.targetNotCallable' })],
    });
  });
});

describe('export and import', () => {
  it('names the workflows it calls and matches them on import', async () => {
    const sub = await workflow('Shared step', called(), chain(shape('x', '{ "x": 1 }')));
    const parent = await workflow('Uses it', onCreated, chain(call('shared', sub.id)));

    const file = await service.export(spaceId, parent.id);
    expect(file.workflows).toEqual([{ id: sub.id, name: 'Shared step', slug: '' }]);

    const { workflow: copy } = await service.import(spaceId, JSON.parse(JSON.stringify(file)));
    const node = copy.nodes.find((entry) => entry.kind === 'call');
    expect(node?.kind === 'call' && node.workflowId).toBe(sub.id);

    // Without its target the copy lands switched off, the node emptied.
    await workflowRepos(repos).workflows.delete(sub.id);
    const { workflow: orphan, notes } = await service.import(spaceId, file);
    expect(orphan).toMatchObject({ enabled: false, publishedVersion: null });
    const emptied = orphan.nodes.find((entry) => entry.kind === 'call');
    expect(emptied?.kind === 'call' && emptied.workflowId).toBeNull();
    expect(notes).toContain(
      `Imported "${orphan.name}" switched off and unpublished: the workflow "Shared step" it runs is not in this space.`,
    );
  });
});
