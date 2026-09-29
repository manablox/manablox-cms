import { type AuditActor, ManabloxError, runFailure, runFailureOf } from '@manablox/core';
import { runAsActor } from '@manablox/core/node';
import {
  emptyRunState,
  isActiveRunStatus,
  type WorkflowNodeLog,
  type WorkflowRunContext,
  type WorkflowRunState,
} from '../../sdk.js';
import { type WorkflowRow, type WorkflowRunRow, withVersion, workflowRepos } from '../db/index.js';
import { WORKFLOWS, workflowKeys } from '../keys.js';
import { RunWalker, type WalkOutcome } from '../walker/index.js';
import { callOutput, callResult, call as startCall } from './calls.js';
import type { EngineContext } from './context.js';

/**
 * `plugins.workflows` must be on, the space writable and `plugins.workflows.runs` not used up
 * (test runs aside); then `workflows:beforeRun`, where a throwing handler refuses the run. A
 * run that passes counts as usage, test runs excepted.
 */
export async function beforeRun(
  ctx: EngineContext,
  workflow: Pick<WorkflowRow, 'id' | 'spaceId'> & Partial<Pick<WorkflowRow, 'environmentId'>>,
  trigger: string,
  test: boolean,
): Promise<void> {
  await ctx.manablox.controls.assertFeature(workflow.spaceId, workflowKeys.feature);
  const { spaceId, environmentId } = workflow;
  await ctx.manablox.controls.assertWritable(environmentId ? { spaceId, environmentId } : spaceId);
  if (!test) {
    await ctx.manablox.controls.assertUsage(workflow.spaceId, workflowKeys.usage.runs);
    await ctx.manablox.controls.assertRate(workflow.spaceId, [
      { rule: workflowKeys.rateLimits.starts, key: workflow.spaceId },
    ]);
  }
  await ctx.manablox.hooks.run(
    'workflows:beforeRun',
    { spaceId: workflow.spaceId, workflowId: workflow.id, trigger, test },
    { manablox: ctx.manablox, spaceId: workflow.spaceId },
  );
  if (!test) ctx.manablox.controls.consume(workflow.spaceId, workflowKeys.usage.runs, 1);
}

/** Persists a run for the workflow and dispatches it; returns its id. */
export async function enqueue(
  ctx: EngineContext,
  workflow: Pick<WorkflowRow, 'id' | 'spaceId' | 'publishedVersion'>,
  trigger: string,
  context: WorkflowRunContext,
): Promise<string> {
  await beforeRun(ctx, workflow, trigger, false);
  return persist(ctx, workflow, trigger, context);
}

const QUIET = new Set([
  'control.feature',
  'control.usage',
  'control.readOnly',
  'control.suspended',
]);

/** Like `enqueue`, but a refused run is logged and skipped; returns `null` then. */
export async function enqueueUnlessRefused(
  ctx: EngineContext,
  workflow: Pick<WorkflowRow, 'id' | 'spaceId' | 'publishedVersion'>,
  trigger: string,
  context: WorkflowRunContext,
): Promise<string | null> {
  try {
    await beforeRun(ctx, workflow, trigger, false);
  } catch (error) {
    // Control refusals skip quietly.
    const quiet = ManabloxError.is(error) && QUIET.has(error.key);
    const level = quiet ? 'debug' : 'warn';
    ctx.manablox.logger[level]({ err: error, workflowId: workflow.id, trigger }, 'run refused');
    return null;
  }
  return persist(ctx, workflow, trigger, context);
}

/** A run to start: the workflow, what started it and its context. */
export interface RunStart {
  workflow: Pick<WorkflowRow, 'id' | 'spaceId' | 'publishedVersion'>;
  trigger: string;
  context: WorkflowRunContext;
}

/**
 * `enqueueUnlessRefused` for several runs: each is checked in order as before, the admitted
 * ones are persisted in one insert and dispatched together. Returns their ids, in order.
 */
export async function enqueueManyUnlessRefused(
  ctx: EngineContext,
  starts: readonly RunStart[],
): Promise<string[]> {
  const admitted: RunStart[] = [];
  for (const start of starts) {
    try {
      await beforeRun(ctx, start.workflow, start.trigger, false);
      admitted.push(start);
    } catch (error) {
      const quiet = ManabloxError.is(error) && QUIET.has(error.key);
      const level = quiet ? 'debug' : 'warn';
      ctx.manablox.logger[level](
        { err: error, workflowId: start.workflow.id, trigger: start.trigger },
        'run refused',
      );
    }
  }
  if (admitted.length === 0) return [];
  const runs = await workflowRepos(ctx.repos).runs.createMany(
    admitted.map(({ workflow, trigger, context }) => ({
      workflowId: workflow.id,
      spaceId: workflow.spaceId,
      trigger,
      context,
      version: workflow.publishedVersion,
    })),
  );
  const ids = runs.map((run) => run.id);
  await ctx.dispatchMany(ids);
  return ids;
}

async function persist(
  ctx: EngineContext,
  workflow: Pick<WorkflowRow, 'id' | 'spaceId' | 'publishedVersion'>,
  trigger: string,
  context: WorkflowRunContext,
): Promise<string> {
  const run = await workflowRepos(ctx.repos).runs.create({
    workflowId: workflow.id,
    spaceId: workflow.spaceId,
    trigger,
    context,
    version: workflow.publishedVersion,
  });
  await ctx.dispatch(run.id);
  return run.id;
}

/** Worker entry point: executes a queued or paused run. */
export async function executeRun(ctx: EngineContext, runId: string): Promise<void> {
  const run = await workflowRepos(ctx.repos).runs.claim(runId);
  if (!run) return;
  const workflow = await definitionFor(ctx, run);
  if (!workflow) {
    const error = runFailure(
      'plugins.workflows.run.workflowGone',
      {},
      'The workflow no longer exists',
    );
    const saved = await workflowRepos(ctx.repos).runs.saveProgress(run.id, {
      status: 'failed',
      state: run.state ?? emptyRunState(),
      log: run.log,
      error,
      finished: true,
    });
    const gone = { id: run.workflowId, spaceId: run.spaceId, name: run.context.workflow.name };
    if (saved) await ctx.lifecycle.reportEnded(gone, run, 'failed', { error: error.message });
    return;
  }

  // Audit everything inside the run as the workflow, not the triggering user.
  const actor: AuditActor = {
    kind: WORKFLOWS,
    id: workflow.id,
    label: workflow.name,
    detail: { runId: run.id, trigger: run.trigger },
  };
  await runAsActor(actor, async () => {
    const pauseRun = (
      id: string,
      state: WorkflowRunState,
      log: WorkflowNodeLog[],
      resumeAt: Date | null,
    ) => pause(ctx, id, state, log, resumeAt);
    const walker = new RunWalker(pauseRun, ctx.manablox, workflow, run, {
      services: ctx.services,
      registry: ctx.registry,
      credentials: ctx.credentials,
      fetch: ctx.safeFetch,
      adminUrl: ctx.adminUrl,
      now: ctx.now,
      isAborted: async () => (await workflowRepos(ctx.repos).runs.findStatus(run.id)) === 'aborted',
      abortCheckMs: ctx.abortCheckMs,
      call: (request) => startCall(ctx, workflow, run, request),
      callResult: (id) => callResult(ctx, id),
    });
    ctx.live.set(run.id, walker);
    try {
      const outcome = await walker.walk();
      // Paused: `pause` saved it. Aborted: `abortRun` reported it; keep what the run did.
      if (outcome.kind === 'ended') {
        await finish(ctx, run, workflow, outcome, walker.storedState(), walker.log);
      } else if (outcome.kind === 'aborted') {
        await workflowRepos(ctx.repos).runs.saveLog(run.id, walker.storedState(), walker.log);
      }
    } finally {
      ctx.live.delete(run.id);
    }
  });
}

/** The workflow as this run walks it: the version it started on, or a test run's draft. */
export async function definitionFor(
  ctx: EngineContext,
  run: WorkflowRunRow,
): Promise<WorkflowRow | null> {
  const row = await workflowRepos(ctx.repos).workflows.findById(run.workflowId);
  if (!row) return null;
  if (run.definition) return { ...row, ...run.definition };
  const version =
    run.version === null
      ? null
      : await workflowRepos(ctx.repos).workflows.findVersion(row.id, run.version);
  if (version) return withVersion(row, version);
  return (await workflowRepos(ctx.repos).workflows.findLive(row.id)) ?? row;
}

async function finish(
  ctx: EngineContext,
  run: WorkflowRunRow,
  workflow: WorkflowRow,
  ended: Extract<WalkOutcome, { kind: 'ended' }>,
  state: WorkflowRunState,
  log: WorkflowNodeLog[],
): Promise<void> {
  let outcome = ended;
  if (workflow.trigger.kind === 'call' && outcome.status !== 'failed') {
    try {
      state.result = callOutput(workflow, run, state);
    } catch (error) {
      const reason = runFailureOf(error).message;
      outcome = {
        kind: 'ended',
        status: 'failed',
        error: runFailure(
          'plugins.workflows.run.outputUnreadable',
          { reason },
          `The output could not be read: ${reason}`,
        ),
      };
    }
  }
  const saved = await workflowRepos(ctx.repos).runs.saveProgress(run.id, {
    status: outcome.status,
    state,
    log,
    error: outcome.error,
    finished: true,
  });
  // Aborted meanwhile: `abortRun` has reported it; keep what the run did.
  if (!saved) {
    await workflowRepos(ctx.repos).runs.saveLog(run.id, state, log);
    return;
  }
  if (!run.test) await workflowRepos(ctx.repos).workflows.touchRun(workflow.id, ctx.now());
  await ctx.lifecycle.reportEnded(workflow, run, outcome.status, {
    version: run.version,
    test: run.test,
    status: outcome.status,
    trigger: run.trigger,
    error: outcome.error?.message ?? null,
    contentId: (run.context.content as { id?: string } | null)?.id ?? null,
    nodes: log.map((entry) => ({ node: entry.name || entry.key, status: entry.status })),
  });
}

/** Saves a paused run. Without `resumeAt` it waits for its called run to end. */
export async function pause(
  ctx: EngineContext,
  runId: string,
  state: WorkflowRunState,
  log: WorkflowNodeLog[],
  resumeAt: Date | null,
): Promise<void> {
  const saved = await workflowRepos(ctx.repos).runs.saveProgress(runId, {
    status: 'waiting',
    state,
    log,
    resumeAt,
  });
  if (!saved) {
    await workflowRepos(ctx.repos).runs.saveLog(runId, state, log);
    return;
  }
  // The called run may have ended before this pause was saved.
  const awaited = state.awaiting
    ? await workflowRepos(ctx.repos).runs.findStatus(state.awaiting.runId)
    : null;
  if (awaited && !isActiveRunStatus(awaited)) {
    await ctx.dispatch(runId);
  }
}
