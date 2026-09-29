import { databaseContextOf } from '@manablox/db';
import { pruneRetention } from '@manablox/services';
import { withControls } from '@manablox/services/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WorkflowTrigger } from '../src/sdk.js';
import { workflowRepos, workflowTables } from '../src/server/db/index.js';
import { bootWorkflowServer, type WorkflowServer } from './helpers/server.js';

let server: WorkflowServer;

const DAY = 24 * 60 * 60_000;
const now = Date.now();
const daysAgo = (days: number) => new Date(now - days * DAY);
const manual = { kind: 'manual', parameters: [] } as unknown as WorkflowTrigger;

beforeAll(async () => {
  server = await bootWorkflowServer('workflows_retention');
}, 90_000);

afterAll(async () => {
  await server?.close();
});

/** A workflow with runs of the given statuses and ages in days, inserted as they are. */
async function withRuns(spaceId: string, runs: ReadonlyArray<[status: string, age: number]>) {
  const workflow = await server.workflow(spaceId, `Aged ${runs.length}`, manual);
  const context = databaseContextOf(server.api.repos);
  const { workflowRuns } = workflowTables(context);
  await context.db.insert(workflowRuns).values(
    runs.map(([status, age]) => ({
      workflowId: workflow.id,
      spaceId,
      trigger: 'manual',
      context: {},
      status,
      createdAt: daysAgo(age),
    })) as never,
  );
  const statuses = async () =>
    (
      await context.db
        .select({ status: workflowRuns.status })
        .from(workflowRuns)
        .where(eq(workflowRuns.workflowId, workflow.id))
    )
      .map((row) => row.status)
      .sort();
  return { workflow, statuses };
}

describe('run retention', () => {
  it('prunes finished runs of one space by age', async () => {
    const spaceId = await server.space();
    const { statuses } = await withRuns(spaceId, [
      ['succeeded', 30],
      ['failed', 20],
      ['waiting', 30],
      ['succeeded', 1],
    ]);
    const runs = workflowRepos(server.api.repos).runs;
    const age = { spaceId, before: daysAgo(10), limit: 1 };
    expect(await runs.prune(undefined, age)).toBe(1);
    expect(await runs.prune(undefined, age)).toBe(1);
    expect(await runs.prune(undefined, age)).toBe(0);
    expect(await statuses()).toEqual(['succeeded', 'waiting']);
  });

  it('prunes runs past retention.plugins.workflows.runsDays in the retention job', async () => {
    const spaceId = await server.space();
    const { statuses } = await withRuns(spaceId, [
      ['succeeded', 5],
      ['queued', 5],
      ['failed', 1],
    ]);
    const restore = await withControls(server.api, {
      scope: { kind: 'space', id: spaceId },
      values: { 'retention.plugins.workflows.runsDays': 2 },
    });
    try {
      const report = await pruneRetention(server.api.manablox, server.api.repos, {
        budgetMs: 10_000,
      });
      expect(report['plugins.workflows.runsDays']).toBe(1);
      expect(await statuses()).toEqual(['failed', 'queued']);
    } finally {
      await restore();
    }
  });

  it('keeps the newest 200 finished runs of a workflow in the pruneRuns maintenance', async () => {
    const spaceId = await server.space();
    const { statuses } = await withRuns(spaceId, [
      ...Array.from({ length: 203 }, () => ['succeeded', 1] as [string, number]),
      ['waiting', 3],
    ]);
    await server.api.jobs.enqueue('workflows:pruneRuns', {});
    await server.api.jobs.idle();
    const left = await statuses();
    expect(left).toHaveLength(201);
    expect(left.filter((status) => status === 'waiting')).toHaveLength(1);
  });
});
