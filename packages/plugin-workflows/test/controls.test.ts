import { definePlugin, onHook, usagePeriod } from '@manablox/core';
import { withControls } from '@manablox/services/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defineWorkflowAction } from '../src/define/action.js';
import { emptyRunState, type WorkflowNode } from '../src/sdk.js';
import { workflowRepos } from '../src/server/db/index.js';
import { action as act, chain, delay, onEvents } from './helpers/graph.js';
import { createWorkflowHarness, START, type WorkflowHarness } from './helpers/harness.js';

let h: WorkflowHarness;
let otherSpace: string;

const calls: string[] = [];
const mails: unknown[] = [];
let pinged = 0;
const hookSpaces: Array<string | null> = [];

const pingAction = defineWorkflowAction({
  type: 'acme.ping',
  label: 'Ping',
  description: '',
  icon: 'bug',
  tone: 'plain',
  group: 'data',
  inputs: [{ name: 'in', label: 'In', type: 'any' }],
  ports: [],
  output: { name: 'ok', label: 'Out', type: 'json' },
  outputPaths: [],
  credential: null,
  fields: [],
  defaults: () => ({}),
  execute: async () => {
    pinged++;
    return { kind: 'ok', output: {} };
  },
});

/** A plugin action behind a feature of its plugin besides the plugin's own flag. */
const shoutAction = defineWorkflowAction({
  ...pingAction,
  type: 'acme.shout',
  label: 'Shout',
  feature: 'plugins.acme.ping.loud',
});

const plugin = definePlugin({
  name: '@acme/ping',
  controls: {
    'features.plugins.acme.ping.loud': { description: 'Shouting nodes.' },
  },
  contributions: { workflows: { actions: [pingAction, shoutAction] } },
  hooks: () => [
    onHook('content:afterCreate', (row) => {
      hookSpaces.push(row.spaceId);
    }),
    onHook('cache:purge', () => {
      hookSpaces.push(null);
    }),
  ],
});

const http = (key = 'call') =>
  act(key, 'http', {
    method: 'POST',
    url: 'https://hooks.test/x',
    headers: [],
    body: { mode: 'none', template: '' },
    secret: null,
    timeoutMs: 5000,
    allowErrorStatus: false,
  });

const email = (key = 'notify') =>
  act(key, 'email', {
    to: ['ops@example.com'],
    toRoles: [],
    subject: 'Hi',
    body: 'Hi',
    html: false,
  });

const ping = (key = 'ping'): WorkflowNode => act(key, 'acme.ping', {});

const refused = (promise: Promise<unknown>) =>
  expect(promise).rejects.toMatchObject({ key: 'control.feature', status: 403 });

const off = (features: Record<string, boolean>, spaceId?: string) =>
  withControls(h.ctx, {
    ...(spaceId ? { scope: { kind: 'space', id: spaceId } } : {}),
    features,
  });

beforeAll(async () => {
  h = await createWorkflowHarness('workflow-controls', {
    config: {
      server: { adminUrl: 'https://admin.test' },
      net: { allowPrivateNetwork: true },
    },
    plugins: [plugin],
    engine: {
      mailer: {
        async send(message) {
          mails.push(message);
          return { id: 'm' };
        },
      },
      pusher: null,
      fetch: (async (input: string | URL | Request) => {
        calls.push(String(input instanceof Request ? input.url : input));
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch,
    },
  });
  otherSpace = (await h.repos.spaces.create({ name: 'O', machineName: 'o', url: 'http://o.test' }))
    .id;
});

afterAll(async () => {
  await h?.close();
});

beforeEach(async () => {
  calls.length = 0;
  mails.length = 0;
  pinged = 0;
  hookSpaces.length = 0;
  for (const spaceId of [h.spaceId, otherSpace]) {
    for (const row of await workflowRepos(h.repos).workflows.listBySpace(spaceId)) {
      await workflowRepos(h.repos).workflows.delete(row.id);
    }
  }
});

const pageIn = (spaceId: string, title: string) =>
  h.content.create({
    spaceId,
    typeId: h.pageType,
    locale: 'en',
    title,
    slug: title.toLowerCase().replace(/\s+/g, '-'),
    fields: {},
  });

describe('plugins.workflows flag', () => {
  it('off at the instance refuses writes and runs, stops triggers and keeps reads', async () => {
    const wf = await h.workflow('Live', onEvents(['content.created']), chain(email()));
    const restore = await off({ 'plugins.workflows': false });
    try {
      await refused(
        h.service.create(h.spaceId, {
          name: 'New',
          trigger: onEvents(['content.created']),
          ...chain(email()),
        }),
      );
      await refused(h.service.setEnabled(h.spaceId, wf.id, false));
      await refused(h.service.duplicate(h.spaceId, wf.id));
      await refused(h.service.delete(h.spaceId, wf.id));
      await refused(h.service.runNow(h.spaceId, wf.id));

      await pageIn(h.spaceId, 'Quiet');
      await h.engine.idle();
      expect(await h.runsOf(wf.id)).toHaveLength(0);
      expect(mails).toHaveLength(0);

      expect((await h.service.get(h.spaceId, wf.id)).name).toBe('Live');
      expect((await h.service.page(h.spaceId)).items).toHaveLength(1);
    } finally {
      await restore();
    }

    await pageIn(h.spaceId, 'Loud');
    await h.engine.idle();
    expect(await h.runsOf(wf.id)).toHaveLength(1);
  });

  it('off in one space leaves the other spaces alone', async () => {
    const wf = await h.workflow('Here', onEvents(['content.created']), chain(email()));
    const restore = await off({ 'plugins.workflows': false }, otherSpace);
    try {
      await refused(
        h.service.create(otherSpace, {
          name: 'There',
          trigger: onEvents(['content.created']),
          ...chain(email()),
        }),
      );
      await pageIn(h.spaceId, 'Still runs');
      await h.engine.idle();
      expect(await h.runsOf(wf.id)).toHaveLength(1);
    } finally {
      await restore();
    }
  });
});

describe('paused runs', () => {
  const later = (minutes: number) => new Date(START.getTime() + minutes * 60_000);
  const paused = async () => {
    const wf = await h.workflow('Waits', onEvents(['content.created']), chain(delay('wait', 5)));
    await pageIn(h.spaceId, `Paused ${wf.id}`);
    await h.engine.idle();
    const [run] = await h.runsOf(wf.id);
    expect(run?.status).toBe('waiting');
    return run as NonNullable<typeof run>;
  };
  const status = async (runId: string) => workflowRepos(h.repos).runs.findById(runId);

  it('stay paused while workflows is off and resume once it is on', async () => {
    const run = await paused();
    const restore = await off({ 'plugins.workflows': false }, h.spaceId);
    try {
      await h.engine.tick(later(10));
      await h.engine.run(run.id);
      await h.engine.idle();
      expect(await status(run.id)).toMatchObject({ status: 'waiting' });
    } finally {
      await restore();
    }
    await h.engine.tick(later(10));
    await h.engine.idle();
    // Ended; a run without actions counts as skipped.
    expect((await status(run.id))?.status).toBe('skipped');
  });

  it('wake a run waiting for its called run through the clock once on', async () => {
    const run = await paused();
    await workflowRepos(h.repos).runs.claim(run.id);
    await workflowRepos(h.repos).runs.saveProgress(run.id, {
      status: 'waiting',
      state: run.state ?? emptyRunState(),
      log: run.log,
      resumeAt: null,
    });
    const restore = await off({ 'plugins.workflows': false }, h.spaceId);
    try {
      await h.engine.run(run.id);
      expect(await status(run.id)).toMatchObject({ status: 'waiting', resumeAt: START });
    } finally {
      await restore();
    }
    await h.engine.tick(later(1));
    await h.engine.idle();
    expect((await status(run.id))?.status).toBe('skipped');
  });

  it('do not crowd out due runs of other spaces', async () => {
    const run = await paused();
    const restore = await off({ 'plugins.workflows': false }, h.spaceId);
    const listed: string[][] = [];
    const original = workflowRepos(h.repos).runs.listDue.bind(workflowRepos(h.repos).runs);
    workflowRepos(h.repos).runs.listDue = async (now, skip = [], limit) => {
      listed.push([...skip]);
      return original(now, skip, limit);
    };
    try {
      await h.engine.tick(later(10));
      await h.engine.idle();
    } finally {
      workflowRepos(h.repos).runs.listDue = original;
      await restore();
    }
    expect(listed).toEqual([[], [h.spaceId]]);
    expect((await status(run.id))?.status).toBe('waiting');
    await h.engine.tick(later(10));
    await h.engine.idle();
  });
});

describe('workflow node flags', () => {
  it('refuses a switched-off node at save and fails it at run', async () => {
    const wf = await h.workflow('Caller', onEvents(['content.created']), chain(http()));
    const restore = await off({ 'plugins.workflows.http': false, 'plugins.workflows.mail': false });
    try {
      await refused(
        h.service.create(h.spaceId, {
          name: 'Http',
          trigger: onEvents(['content.created']),
          ...chain(http()),
        }),
      );
      await refused(
        h.service.create(h.spaceId, {
          name: 'Mail',
          trigger: onEvents(['content.created']),
          ...chain(email()),
        }),
      );
      await refused(
        h.service.update(h.spaceId, wf.id, {
          name: 'Caller',
          trigger: onEvents(['content.created']),
          ...chain(http('again')),
        }),
      );
      // Other nodes still save.
      await h.service.create(h.spaceId, {
        name: 'Ping',
        trigger: onEvents(['content.created']),
        ...chain(ping()),
      });

      await pageIn(h.spaceId, 'Refused node');
      await h.engine.idle();
      const [run] = await h.runsOf(wf.id);
      expect(run?.status).toBe('failed');
      expect(run?.log[0]).toMatchObject({ status: 'failed' });
      expect(JSON.stringify(run?.log[0])).toContain('control.feature');
      expect(calls).toHaveLength(0);
    } finally {
      await restore();
    }
  });
});

describe('plugin flag', () => {
  it('switches off its actions and its hooks per space; spaceless hooks run', async () => {
    const restore = await off({ 'plugins.acme.ping': false }, h.spaceId);
    try {
      await refused(
        h.service.create(h.spaceId, {
          name: 'Ping',
          trigger: onEvents(['content.created']),
          ...chain(ping()),
        }),
      );
      await h.service.create(otherSpace, {
        name: 'Ping there',
        trigger: onEvents(['content.created']),
        ...chain(ping()),
      });

      await pageIn(h.spaceId, 'Plugin off');
      await pageIn(otherSpace, 'Plugin on');
      expect(hookSpaces).toEqual([otherSpace]);

      await h.manablox.hooks.run('cache:purge', { tags: [] }, { manablox: h.manablox });
      expect(hookSpaces).toEqual([otherSpace, null]);
    } finally {
      await restore();
    }

    await h.workflow('Ping', onEvents(['content.created']), chain(ping()));
    await pageIn(h.spaceId, 'Plugin back');
    await h.engine.idle();
    expect(pinged).toBe(1);
    expect(hookSpaces).toContain(h.spaceId);
  });
});

describe('an action feature', () => {
  it("refuses the plugin's action behind it and leaves its other actions alone", async () => {
    const restore = await off({ 'plugins.acme.ping.loud': false }, h.spaceId);
    try {
      await refused(
        h.service.create(h.spaceId, {
          name: 'Shout',
          trigger: onEvents(['content.created']),
          ...chain(act('shout', 'acme.shout', {})),
        }),
      );
      const still = await h.service.create(h.spaceId, {
        name: 'Ping still',
        enabled: false,
        trigger: onEvents(['content.created']),
        ...chain(ping()),
      });
      await h.service.delete(h.spaceId, still.id);
    } finally {
      await restore();
    }
    const catalog = await h.service.catalog(h.spaceId);
    expect(catalog.actions.find((entry) => entry.type === 'acme.shout')?.feature).toBe(
      'plugins.acme.ping.loud',
    );
  });
});

describe('count limits', () => {
  const limited = (promise: Promise<unknown>, limit: string) =>
    expect(promise).rejects.toMatchObject({
      key: 'control.limit',
      status: 409,
      details: [{ params: { limit } }],
    });
  const limit = (key: string, max: number, mode = 'hard') =>
    withControls(h.ctx, {
      scope: { kind: 'space', id: otherSpace },
      values: { [`limits.${key}`]: { max, mode } },
    });
  const enabled = (name: string) => ({
    name,
    trigger: onEvents(['content.created']),
    ...chain(email()),
    enabled: true,
  });

  it('counts enabled workflows at save and switch-on', async () => {
    const first = await h.service.create(otherSpace, enabled('One'));
    const restore = await limit('plugins.workflows.active', 1);
    try {
      await limited(h.service.create(otherSpace, enabled('Two')), 'plugins.workflows.active');
      const off = await h.service.create(otherSpace, { ...enabled('Off'), enabled: false });
      await limited(h.service.setEnabled(otherSpace, off.id, true), 'plugins.workflows.active');
      // A file import arrives switched off.
      const imported = await h.service.import(
        otherSpace,
        await h.service.export(otherSpace, first.id),
      );
      expect(imported.workflow.enabled).toBe(false);
      // Switching off and on again frees and takes the one slot.
      await h.service.setEnabled(otherSpace, first.id, false);
      await h.service.setEnabled(otherSpace, off.id, true);
    } finally {
      await restore();
    }
    const soft = await limit('plugins.workflows.active', 1, 'soft');
    try {
      await h.service.create(otherSpace, enabled('Soft'));
    } finally {
      await soft();
    }
  });
});

describe('usage limits', () => {
  /** Uses up `metric` in the space and evaluates the state. */
  const usedUp = async (metric: string) => {
    const restore = await withControls(h.ctx, {
      scope: { kind: 'space', id: h.spaceId },
      values: { [`usage.${metric}`]: { max: 1, mode: 'hard' } },
    });
    const period = usagePeriod(new Date()).label;
    const key = { scope: { kind: 'space' as const, id: h.spaceId }, metric, period };
    const before = await h.repos.usageCounters.get(key);
    await h.repos.usageCounters.set(key, 1);
    await h.ctx.controlStore.usageState?.evaluate();
    return async () => {
      await restore();
      await h.repos.usageCounters.set(key, before);
      await h.ctx.controlStore.usageState?.evaluate();
    };
  };

  it('refuses runs at enqueue while plugins.workflows.runs is used up', async () => {
    const wf = await h.workflow('Counted', onEvents(['content.created']), chain(ping()));
    const restore = await usedUp('plugins.workflows.runs');
    try {
      await pageIn(h.spaceId, 'Not run');
      await h.engine.idle();
      expect(await h.runsOf(wf.id)).toHaveLength(0);
    } finally {
      await restore();
    }
    await pageIn(h.spaceId, 'Runs again');
    await h.engine.idle();
    expect(await h.runsOf(wf.id)).toHaveLength(1);
  });

  it('fails the mail node with control.usage while mails are used up', async () => {
    const wf = await h.workflow('Mailer', onEvents(['content.created']), chain(email()));
    const restore = await usedUp('mails');
    try {
      await pageIn(h.spaceId, 'No mail');
      await h.engine.idle();
      const [run] = await h.runsOf(wf.id);
      expect(run?.status).toBe('failed');
      expect(JSON.stringify(run?.log[0])).toContain('control.usage');
      expect(mails).toHaveLength(0);
    } finally {
      await restore();
    }
  });
});

describe('state', () => {
  it('starts no run while the space is read-only; runs again once active', async () => {
    const wf = await h.workflow('Stateful', onEvents(['content.created']), chain(ping()));
    const restore = await withControls(h.ctx, {
      scope: { kind: 'space', id: h.spaceId },
      values: { state: { status: 'readOnly', message: 'Over the plan' } },
    });
    try {
      await pageIn(h.spaceId, 'Read-only, not run');
      await h.engine.idle();
      expect(await h.runsOf(wf.id)).toHaveLength(0);
    } finally {
      await restore();
    }
    await pageIn(h.spaceId, 'Active, runs again');
    await h.engine.idle();
    expect(await h.runsOf(wf.id)).toHaveLength(1);
  });
});
