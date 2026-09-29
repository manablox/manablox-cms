import {
  isActiveRunStatus,
  type WorkflowAbortContext,
  type WorkflowAbortTrigger,
  type WorkflowRunAbort,
} from '../../sdk.js';
import { evaluateCondition } from '../conditions.js';
import type { ActiveWorkflowRun } from '../db/index.js';
import { workflowRepos } from '../db/index.js';
import type { WorkflowRef } from '../run-lifecycle.js';
import type { EngineContext } from './context.js';
import { abortSelects } from './matchers.js';

/** Aborts the active runs each trigger's filter and match select; returns their ids. */
export async function abortByTriggers(
  ctx: EngineContext,
  workflow: WorkflowRef,
  triggers: WorkflowAbortTrigger[],
  context: WorkflowAbortContext,
  source: WorkflowRunAbort['source'],
  event: string,
): Promise<string[]> {
  let active: ActiveWorkflowRun[] | null = null;
  const aborted: string[] = [];
  for (const trigger of triggers) {
    if (trigger.filter && !evaluateCondition(trigger.filter, context)) continue;
    active ??= await workflowRepos(ctx.repos).runs.listActiveByWorkflow(workflow.id);
    for (const run of active) {
      if (aborted.includes(run.id) || !abortSelects(trigger, run, context)) continue;
      const abort: WorkflowRunAbort = {
        source,
        triggerId: trigger.id,
        event,
        actor: null,
        reason: null,
        at: ctx.now().toISOString(),
      };
      if (await abortRun(ctx, workflow, run, abort)) aborted.push(run.id);
    }
  }
  return aborted;
}

/** Aborts every active run of a workflow; returns their ids. */
export async function abortAll(
  ctx: EngineContext,
  workflow: WorkflowRef,
  abort: WorkflowRunAbort,
): Promise<string[]> {
  const aborted: string[] = [];
  for (const run of await workflowRepos(ctx.repos).runs.listActiveByWorkflow(workflow.id)) {
    if (await abortRun(ctx, workflow, run, abort)) aborted.push(run.id);
  }
  return aborted;
}

/** Aborts one run; false when it had already ended. A running walker stops before its next node. */
export async function abortRun(
  ctx: EngineContext,
  workflow: WorkflowRef,
  run: Pick<ActiveWorkflowRun, 'id' | 'trigger' | 'test' | 'context' | 'state'>,
  abort: WorkflowRunAbort,
): Promise<boolean> {
  const from = await workflowRepos(ctx.repos).runs.abort(run.id, abort);
  if (!from) return false;
  ctx.live.get(run.id)?.stop();
  const called = ctx.calling.get(run.id) ?? run.state?.awaiting?.runId;
  if (called) await abortCalled(ctx, called, abort);
  await ctx.lifecycle.reportEnded(workflow, run, 'aborted', { from, ...abort });
  return true;
}

/** Aborts the run a caller was waiting for, since nothing waits for it any more. */
async function abortCalled(
  ctx: EngineContext,
  runId: string,
  abort: WorkflowRunAbort,
): Promise<void> {
  const run = await workflowRepos(ctx.repos).runs.findById(runId);
  if (!run || !isActiveRunStatus(run.status)) return;
  const workflow = await workflowRepos(ctx.repos).workflows.findById(run.workflowId);
  if (!workflow) return;
  await abortRun(ctx, workflow, run, {
    ...abort,
    source: 'caller',
    triggerId: null,
    reason: 'The run that called it was aborted',
  });
}
