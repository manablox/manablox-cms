import { ManabloxError, type ManabloxHooks } from '@manablox/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowActionContext } from '../src/define/action.js';
import type { WorkflowTrigger } from '../src/sdk.js';
import { emailAction } from '../src/server/actions/email.js';
import { workflowRepos } from '../src/server/db/index.js';
import { chain, onCreated, shape } from './helpers/graph.js';
import { createWorkflowHarness, type WorkflowHarness } from './helpers/harness.js';

let h: WorkflowHarness;

beforeAll(async () => {
  h = await createWorkflowHarness('workflow-hooks');
});
afterAll(async () => {
  await h?.close();
});
beforeEach(async () => {
  await h.engine.idle();
  for (const row of await workflowRepos(h.repos).workflows.listBySpace(h.spaceId)) {
    await workflowRepos(h.repos).workflows.delete(row.id);
  }
});

const refusal = () => ManabloxError.forbidden('auth.forbidden');

/** Refuses every call of `hook` while `run` runs; returns the payloads it saw. */
async function refusing<K extends keyof ManabloxHooks & string, T>(
  hook: K,
  run: () => Promise<T>,
): Promise<{ seen: ManabloxHooks[K][0][]; result: Promise<T> }> {
  const seen: ManabloxHooks[K][0][] = [];
  const off = h.manablox.hooks.on(hook, (payload) => {
    seen.push(payload);
    throw refusal();
  });
  const result = run();
  await result.catch(() => {});
  off();
  return { seen, result };
}

const manual: WorkflowTrigger = { kind: 'manual', parameters: [] };
const graph = () => chain(shape('out', '{ "ok": true }'));

describe('workflows:beforeEnable', () => {
  it('refuses creating, saving and switching a workflow on, but not a disabled one', async () => {
    const created = await refusing('workflows:beforeEnable', () =>
      h.service.create(h.spaceId, { name: 'On', trigger: manual, ...graph(), enabled: true }),
    );
    await expect(created.result).rejects.toMatchObject({ key: 'auth.forbidden' });
    expect(created.seen).toEqual([{ spaceId: h.spaceId, id: null, name: 'On' }]);

    const off = await h.service.create(h.spaceId, { name: 'Off', trigger: manual, ...graph() });
    expect(off.enabled).toBe(false);

    const saved = await refusing('workflows:beforeEnable', () =>
      h.service.update(h.spaceId, off.id, {
        name: 'Off',
        trigger: manual,
        ...graph(),
        enabled: true,
      }),
    );
    await expect(saved.result).rejects.toMatchObject({ key: 'auth.forbidden' });
    expect(saved.seen).toEqual([{ spaceId: h.spaceId, id: off.id, name: 'Off' }]);

    const switched = await refusing('workflows:beforeEnable', () =>
      h.service.setEnabled(h.spaceId, off.id, true),
    );
    await expect(switched.result).rejects.toMatchObject({ key: 'auth.forbidden' });
    expect((await h.service.get(h.spaceId, off.id)).enabled).toBe(false);

    // Switching off is never refused.
    const offAgain = await refusing('workflows:beforeEnable', () =>
      h.service.setEnabled(h.spaceId, off.id, false),
    );
    await expect(offAgain.result).resolves.toMatchObject({ enabled: false });
    expect(offAgain.seen).toEqual([]);
  });
});

describe('workflows:beforeRun', () => {
  it('refuses a manual start and a test run', async () => {
    const wf = await h.workflow('Manual', manual, graph());

    const started = await refusing('workflows:beforeRun', () => h.service.start(h.spaceId, wf.id));
    await expect(started.result).rejects.toMatchObject({ key: 'auth.forbidden' });
    expect(started.seen).toEqual([
      { spaceId: h.spaceId, workflowId: wf.id, trigger: 'manual', test: false },
    ]);

    const tested = await refusing('workflows:beforeRun', () => h.service.runNow(h.spaceId, wf.id));
    await expect(tested.result).rejects.toMatchObject({ key: 'auth.forbidden' });
    expect(tested.seen).toEqual([
      { spaceId: h.spaceId, workflowId: wf.id, trigger: 'manual', test: true },
    ]);
    expect(await h.runsOf(wf.id)).toEqual([]);
  });

  it('counts a started run as usage, but not a test run or a refused one', async () => {
    const wf = await h.workflow('Counted', manual, graph());
    const consume = vi.spyOn(h.manablox.controls, 'consume');
    try {
      await h.service.start(h.spaceId, wf.id);
      await h.service.runNow(h.spaceId, wf.id);
      const refused = await refusing('workflows:beforeRun', () =>
        h.service.start(h.spaceId, wf.id),
      );
      await expect(refused.result).rejects.toMatchObject({ key: 'auth.forbidden' });
      await h.engine.idle();
      expect(
        consume.mock.calls.filter(([, metric]) => metric === 'plugins.workflows.runs'),
      ).toEqual([[h.spaceId, 'plugins.workflows.runs', 1]]);
    } finally {
      consume.mockRestore();
    }
  });

  it('skips an event run it refuses, and the content write goes through', async () => {
    const wf = await h.workflow('On create', onCreated, graph());
    const { seen, result } = await refusing('workflows:beforeRun', () => h.page('Refused run'));
    await expect(result).resolves.toMatchObject({ title: 'Refused run' });
    await h.engine.idle();
    expect(seen).toEqual([
      { spaceId: h.spaceId, workflowId: wf.id, trigger: 'content.created', test: false },
    ]);
    expect(await h.runsOf(wf.id)).toEqual([]);

    await h.page('Allowed run');
    await h.engine.idle();
    expect(await h.runsOf(wf.id)).toHaveLength(1);
  });
});

describe('mail:afterSend', () => {
  it('reports a mail sent by the email action', async () => {
    const sent: ManabloxHooks['mail:afterSend'][0][] = [];
    const off = h.manablox.hooks.on('mail:afterSend', (payload) => {
      sent.push(payload);
    });
    const ctx = {
      config: { to: ['a@b.test', 'c@d.test'], toRoles: [], subject: 'Hi', body: 'There' },
      render: (template: string) => template,
      run: { space: { id: h.spaceId } },
      workflow: { id: 'w', name: 'W', spaceId: h.spaceId },
      manablox: h.manablox,
      services: { mailer: { send: async () => ({ id: 'm1' }) }, repos: h.repos },
    } as unknown as WorkflowActionContext<never>;
    try {
      await emailAction.execute(ctx as never);
    } finally {
      off();
    }
    expect(sent).toEqual([
      { spaceId: h.spaceId, kind: 'workflows', recipients: 2, transport: 'instance' },
    ]);
  });
});
