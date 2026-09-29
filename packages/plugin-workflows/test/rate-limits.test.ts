import { memoryRateLimitStore, RetryLater } from '@manablox/core';
import { withControls } from '@manablox/services/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { workflowRepos } from '../src/server/db/index.js';
import { action as act, chain, onEvents } from './helpers/graph.js';
import { createWorkflowHarness, type WorkflowHarness } from './helpers/harness.js';

let h: WorkflowHarness;

const ping = () =>
  act('call', 'http', {
    method: 'POST',
    url: 'https://hooks.test/x',
    headers: [],
    body: { mode: 'none', template: '' },
    secret: null,
    timeoutMs: 5000,
    allowErrorStatus: false,
  });

beforeAll(async () => {
  h = await createWorkflowHarness('workflow-rate-limits', {
    config: { net: { allowPrivateNetwork: true } },
    engine: {
      fetch: (async () => new Response('{}', { status: 200 })) as typeof fetch,
    },
  });
});

afterAll(async () => {
  await h?.close();
});

beforeEach(async () => {
  h.ctx.controlStore.rates = memoryRateLimitStore();
  for (const row of await workflowRepos(h.repos).workflows.listBySpace(h.spaceId)) {
    await workflowRepos(h.repos).workflows.delete(row.id);
  }
});

const space = () => ({ kind: 'space' as const, id: h.spaceId });

describe('plugins.workflows.concurrency', () => {
  it('holds a run back while every slot is taken, then runs it', async () => {
    const restore = await withControls(h.ctx, {
      scope: space(),
      values: { 'rateLimits.plugins.workflows.concurrency': { max: 1 } },
    });
    try {
      const wf = await h.workflow('Slotted', onEvents(['content.created']), chain(ping()));
      const held = await h.manablox.controls.acquire(
        h.spaceId,
        'plugins.workflows.concurrency',
        60_000,
      );
      expect(held).not.toBeNull();
      // Dispatched in the background, where it waits for the slot.
      await h.page('Waits');
      await h.engine.idle();
      const [run] = await h.runsOf(wf.id);
      if (!run) throw new Error('no run');
      expect(run.status).toBe('queued');

      const deferred = await h.engine.run(run.id).then(
        () => null,
        (error: unknown) => error,
      );
      expect(RetryLater.is(deferred)).toBe(true);
      expect((deferred as RetryLater).delay).toBeGreaterThanOrEqual(5_000);
      expect(await workflowRepos(h.repos).runs.findStatus(run.id)).toBe('queued');

      await held?.release();
      await h.engine.run(run.id);
      expect(await workflowRepos(h.repos).runs.findStatus(run.id)).toBe('succeeded');
      // The run gave its slot back.
      const again = await h.manablox.controls.acquire(
        h.spaceId,
        'plugins.workflows.concurrency',
        1_000,
      );
      expect(again).not.toBeNull();
      await again?.release();
    } finally {
      await restore();
    }
  });
});

describe('plugins.workflows.starts', () => {
  it('skips starts past the space budget', async () => {
    const restore = await withControls(h.ctx, {
      scope: space(),
      values: { 'rateLimits.plugins.workflows.starts': { max: 1, windowSeconds: 60 } },
    });
    try {
      const wf = await h.workflow('Budget', onEvents(['content.created']), chain(ping()));
      await h.page('First');
      await h.page('Second');
      await h.engine.idle();
      expect(await h.runsOf(wf.id)).toHaveLength(1);
    } finally {
      await restore();
    }
  });
});
