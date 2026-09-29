import type { Repositories } from '@manablox/db';
import type { ServiceContext } from '@manablox/services/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WorkflowTrigger } from '../src/sdk.js';
import { workflowRepos } from '../src/server/db/index.js';
import type { WorkflowEngine } from '../src/server/engine/index.js';
import type { WorkflowService } from '../src/server/services/workflow.service.js';
import { action, chain } from './helpers/graph.js';
import { createWorkflowHarness } from './helpers/harness.js';

/**
 * Cost of a workflow clock tick (every 20s) when nothing is due, and of a content save with
 * many live workflows. `PERF=1` prints numbers.
 */
const WORKFLOWS = 40;

let ctx: ServiceContext;
let repos: Repositories;
let engine: WorkflowEngine;
let service: WorkflowService;

/** One node after the trigger, which is the smallest graph the validator accepts. */
let seq = 0;
const graph = () =>
  chain(
    action(`step${++seq}`, 'email', {
      to: ['ops@example.com'],
      toRoles: [],
      subject: 'hello',
      body: 'there',
      html: false,
    }),
  );

/** A workflow on a schedule that is or is not due at the test's clock. */
const schedule = (cron: string): WorkflowTrigger => ({
  kind: 'schedule',
  cron,
  timezone: 'UTC',
  selection: null,
  perDocument: false,
});

beforeAll(async () => {
  const h = await createWorkflowHarness('workflow_tick_perf', {
    engine: { now: () => new Date() },
    listen: false,
  });
  ({ ctx, repos, engine, service } = h);

  for (let index = 0; index < WORKFLOWS; index++) {
    await service.create(
      ctx.spaceId,
      {
        name: `Nightly ${index}`,
        // Three in the morning, so nothing is due at the clock the tests use.
        trigger: schedule('0 3 * * *'),
        ...graph(),
        enabled: true,
      },
      { publish: true },
    );
  }
}, 300_000);

afterAll(async () => {
  await ctx?.close();
});

/** Statements that read a workflow graph. */
const graphReads = () => ctx.queries().filter((query) => /"nodes"/.test(query));

function report(label: string, count: number): void {
  if (!process.env.PERF) return;
  console.log(`[perf] ${label}: ${count} statements`);
  const groups = new Map<string, number>();
  for (const query of ctx.queries()) {
    const shape = query.replace(/\s+/g, ' ').trim().slice(0, 60);
    groups.set(shape, (groups.get(shape) ?? 0) + 1);
  }
  for (const [shape, n] of [...groups].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`  ${String(n).padStart(4)}  ${shape}`);
  }
}

describe(`the workflow tick (${WORKFLOWS} enabled workflows)`, () => {
  it('costs the same whether there are forty workflows or one', async () => {
    ctx.resetQueryCount();
    await engine.tick(new Date('2026-09-09T12:00:00.000Z'));
    const count = ctx.queryCount();
    report('tick, nothing due', count);
    // The enabled list and the due runs, and nothing per workflow: a claim is taken only
    // after the cron matches the minute.
    expect(count).toBeLessThanOrEqual(4);
    expect(graphReads()).toEqual([]);
  });

  it('claims only the workflows whose minute has come', async () => {
    await service.create(
      ctx.spaceId,
      {
        name: 'Every minute',
        trigger: schedule('* * * * *'),
        ...graph(),
        enabled: true,
      },
      { publish: true },
    );
    ctx.resetQueryCount();
    await engine.tick(new Date('2026-09-09T12:01:00.000Z'));
    const count = ctx.queryCount();
    report('tick, one workflow due', count);
    // One more than the quiet tick by a handful, not by forty.
    expect(count).toBeLessThan(WORKFLOWS);
  });
});

describe(`a content save with ${WORKFLOWS} live workflows`, () => {
  const onDeleted: WorkflowTrigger = {
    kind: 'event',
    events: ['content.deleted'],
    typeIds: [],
    locales: [],
  };
  const save = (title: string) =>
    ctx.content.create({
      spaceId: ctx.spaceId,
      typeId: ctx.ids.page as string,
      locale: 'en',
      title,
      slug: title.toLowerCase().replace(/\s+/g, '-'),
      fields: {},
    });

  it('reads triggers once without graphs, then from the index', async () => {
    engine.listen();
    for (let index = 0; index < WORKFLOWS; index++) {
      await service.create(
        ctx.spaceId,
        { name: `On delete ${index}`, trigger: onDeleted, ...graph(), enabled: true },
        { publish: true },
      );
    }

    ctx.resetQueryCount();
    await save('First save');
    const first = ctx.queryCount();
    report('first save', first);
    expect(graphReads()).toEqual([]);
    const lookups = ctx.queries().filter((query) => /"workflows_versions"/.test(query));
    expect(lookups).toHaveLength(1);

    ctx.resetQueryCount();
    await save('Second save');
    report('second save', ctx.queryCount());
    expect(ctx.queries().filter((query) => /"workflow/.test(query))).toEqual([]);
    // The save's own statements only: nothing grows with the live workflows.
    expect(ctx.queryCount()).toBeLessThan(first);

    // Publishing drops the index, so the new workflow starts on the next save.
    const created: WorkflowTrigger = { ...onDeleted, events: ['content.created'] };
    const listener = await service.create(
      ctx.spaceId,
      { name: 'On create', trigger: created, ...graph(), enabled: true },
      { publish: true },
    );
    await save('Third save');
    await engine.idle();
    expect((await workflowRepos(repos).runs.pageByWorkflow(listener.id)).total).toBe(1);
  });
});
