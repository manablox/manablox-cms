import { runAsActor } from '@manablox/core/node';
import type { Repositories } from '@manablox/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorkflowTrigger } from '../src/sdk.js';
import { workflowRepos } from '../src/server/db/index.js';
import type { WorkflowEngine } from '../src/server/engine/index.js';
import type { WorkflowService } from '../src/server/services/workflow.service.js';
import { chain, onCreated, shape } from './helpers/graph.js';
import { createWorkflowHarness, type WorkflowHarness } from './helpers/harness.js';

let h: WorkflowHarness;
let repos: Repositories;
let engine: WorkflowEngine;
let service: WorkflowService;
let spaceId: string;
let workflow: WorkflowHarness['workflow'];
let runsOf: WorkflowHarness['runsOf'];

const manual = (parameters: Array<{ name: string; required?: boolean }> = []): WorkflowTrigger => ({
  kind: 'manual',
  parameters: parameters.map((entry) => ({
    name: entry.name,
    description: '',
    required: entry.required ?? false,
  })),
});

const greet = () => chain(shape('greet', '{ "hi": "{{ input.who }}", "by": "{{ actor.email }}" }'));

beforeAll(async () => {
  h = await createWorkflowHarness('workflow-manual');
  ({ repos, engine, service, spaceId, workflow, runsOf } = h);
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

describe('manual workflows', () => {
  it('starts the live version with the values and who started it', async () => {
    const wf = await workflow('Greet', manual([{ name: 'who', required: true }]), greet());
    const user = await repos.users.create({
      name: 'Ann',
      email: 'ann-manual@example.com',
      role: 'editor',
      passwordHash: 'x',
    });

    const started = await runAsActor({ kind: 'user', id: user.id, label: user.email }, () =>
      service.start(spaceId, wf.id, { who: 'Ada', ignored: 'x' }),
    );
    await engine.idle();

    const [run] = await runsOf(wf.id);
    expect(run?.id).toBe(started.id);
    expect(run).toMatchObject({ status: 'succeeded', trigger: 'manual', test: false, version: 1 });
    expect(run?.context.input).toEqual({ who: 'Ada' });
    expect(run?.state.outputs.greet?.value).toEqual({ hi: 'Ada', by: 'ann-manual@example.com' });
  });

  it('fills optional values it was not given with blanks', async () => {
    const wf = await workflow('Optional', manual([{ name: 'who' }]), greet());
    await service.start(spaceId, wf.id);
    await engine.idle();
    const [run] = await runsOf(wf.id);
    expect(run?.context.input).toEqual({ who: '' });
    expect(run?.context.actor).toBeNull();
  });

  it('refuses a missing required value', async () => {
    const wf = await workflow('Strict', manual([{ name: 'who', required: true }]), greet());
    await expect(service.start(spaceId, wf.id, { who: '' })).rejects.toMatchObject({
      key: 'plugins.workflows.run.inputMissing',
      details: [{ params: { parameter: 'who' } }],
    });
    expect(await runsOf(wf.id)).toHaveLength(0);
  });

  it('refuses unpublished, switched-off and differently triggered workflows', async () => {
    const draft = await service.create(spaceId, { name: 'Draft', trigger: manual(), ...greet() });
    await expect(service.start(spaceId, draft.id)).rejects.toMatchObject({
      key: 'plugins.workflows.run.unpublished',
    });

    const off = await workflow('Off', manual(), greet(), { enabled: false });
    await expect(service.start(spaceId, off.id)).rejects.toMatchObject({
      key: 'plugins.workflows.run.disabled',
    });

    const event = await workflow('Event', onCreated, greet());
    await expect(service.start(spaceId, event.id)).rejects.toMatchObject({
      key: 'plugins.workflows.run.notManual',
    });
  });

  it('runs what is live, not a draft switched to a manual trigger', async () => {
    const wf = await workflow('Switched', onCreated, greet());
    await service.update(spaceId, wf.id, { name: 'Switched', trigger: manual(), ...greet() });
    await expect(service.start(spaceId, wf.id)).rejects.toMatchObject({
      key: 'plugins.workflows.run.notManual',
    });
  });

  it('test-runs the draft with its values filled in', async () => {
    const wf = await workflow('Tested', manual([{ name: 'who' }]), greet());
    const run = await service.runNow(spaceId, wf.id, { input: { who: 'Bo' } });
    expect(run).toMatchObject({ status: 'succeeded', trigger: 'manual', test: true });
    expect(run.state.outputs.greet?.value).toEqual({ hi: 'Bo', by: null });
  });
});
