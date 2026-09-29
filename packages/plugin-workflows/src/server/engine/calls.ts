import { RunError } from '@manablox/core';
import { nodesOf, WORKFLOW_MAX_CALL_DEPTH, type WorkflowRunState } from '../../sdk.js';
import type { WorkflowRow, WorkflowRunRow } from '../db/index.js';
import { workflowRepos } from '../db/index.js';
import type { EndedRun } from '../run-lifecycle.js';
import { evaluate } from '../template.js';
import type { WorkflowCallRequest, WorkflowCallResult } from '../walker/index.js';
import { type EngineContext, runContext } from './context.js';
import { beforeRun } from './lifecycle.js';

/**
 * Starts a run of a workflow with a `call` trigger on behalf of a call node. Waiting, the
 * run goes through inline; the caller pauses when it pauses.
 */
export async function call(
  ctx: EngineContext,
  caller: WorkflowRow,
  callerRun: WorkflowRunRow,
  request: WorkflowCallRequest,
): Promise<WorkflowCallResult> {
  const target = await workflowRepos(ctx.repos).workflows.findLive(request.workflowId);
  // Only a workflow of the caller's environment is callable.
  if (!target || target.environmentId !== caller.environmentId) {
    const draft = await workflowRepos(ctx.repos).workflows.findById(request.workflowId);
    if (draft?.environmentId === caller.environmentId) {
      throw new RunError(
        'plugins.workflows.run.callTargetUnpublished',
        { name: draft.name },
        `"${draft.name}" is not published`,
      );
    }
    throw new RunError(
      'plugins.workflows.call.targetNotFound',
      {},
      'The workflow to run no longer exists',
    );
  }
  const name = target.name;
  if (target.trigger.kind !== 'call') {
    throw new RunError(
      'plugins.workflows.call.targetNotCallable',
      { name },
      `"${name}" does not start when another workflow runs it`,
    );
  }
  if (!target.enabled) {
    throw new RunError(
      'plugins.workflows.run.callTargetDisabled',
      { name },
      `"${name}" is switched off`,
    );
  }
  const chain = [...(request.context.caller?.chain ?? []), caller.id];
  if (chain.includes(target.id)) {
    throw new RunError(
      'plugins.workflows.run.callCycle',
      { name },
      `"${name}" is already running further up this chain of calls`,
    );
  }
  if (chain.length > WORKFLOW_MAX_CALL_DEPTH) {
    throw new RunError(
      'plugins.workflows.run.callTooDeep',
      { max: WORKFLOW_MAX_CALL_DEPTH },
      `Workflows may only call ${WORKFLOW_MAX_CALL_DEPTH} deep`,
    );
  }
  for (const parameter of target.trigger.parameters) {
    const value = request.input[parameter.name];
    if (parameter.required && (value === undefined || value === null || value === '')) {
      throw new RunError(
        'plugins.workflows.run.callInputMissing',
        { name, parameter: parameter.name },
        `"${name}" needs a value for "${parameter.name}"`,
      );
    }
  }

  await beforeRun(ctx, target, 'call', callerRun.test);
  const { context } = request;
  const run = await workflowRepos(ctx.repos).runs.create({
    workflowId: target.id,
    spaceId: target.spaceId,
    trigger: 'call',
    version: target.publishedVersion,
    test: callerRun.test,
    context: runContext(
      {
        event: 'call',
        workflow: { id: target.id, name: target.name },
        space: context.space,
        at: ctx.now().toISOString(),
      },
      {
        ...(context.environment ? { environment: context.environment } : {}),
        content: context.content,
        previous: context.previous,
        documents: context.documents,
        actor: context.actor,
        url: context.url,
        input: request.input,
        caller: {
          workflowId: caller.id,
          workflowName: caller.name,
          runId: callerRun.id,
          nodeKey: request.nodeKey,
          wait: request.wait,
          chain,
        },
      },
    ),
  });

  if (!request.wait) {
    await ctx.dispatch(run.id);
    return {
      runId: run.id,
      workflowName: target.name,
      status: 'queued',
      output: null,
      error: null,
    };
  }
  ctx.calling.set(callerRun.id, run.id);
  try {
    await ctx.run(run.id);
  } finally {
    ctx.calling.delete(callerRun.id);
  }
  return (
    (await callResult(ctx, run.id)) ?? {
      runId: run.id,
      workflowName: target.name,
      status: 'failed',
      output: null,
      error: 'The called run no longer exists',
    }
  );
}

export async function callResult(
  ctx: EngineContext,
  runId: string,
): Promise<WorkflowCallResult | null> {
  const run = await workflowRepos(ctx.repos).runs.findById(runId);
  if (!run) return null;
  return {
    runId: run.id,
    workflowName: run.context.workflow.name,
    status: run.status,
    output: run.state?.result ?? null,
    error: run.error ?? (run.status === 'aborted' ? 'it was aborted' : null),
  };
}

/** Wakes the run that paused for this one, once this one has ended. */
export async function resumeCaller(ctx: EngineContext, run: EndedRun): Promise<void> {
  const caller = run.context.caller;
  if (!caller?.wait) return;
  const waiting = await workflowRepos(ctx.repos).runs.findById(caller.runId);
  if (waiting?.status !== 'waiting' || waiting.state?.awaiting?.runId !== run.id) return;
  await ctx.dispatch(waiting.id);
}

/** What a called run hands back: its trigger's `output`, or every node's output. */
export function callOutput(
  workflow: WorkflowRow,
  run: WorkflowRunRow,
  state: WorkflowRunState,
): unknown {
  const nodes = nodesOf(state);
  const template = workflow.trigger.kind === 'call' ? workflow.trigger.output.trim() : '';
  if (!template) return nodes;
  return evaluate(template, { ...run.context, nodes }) ?? null;
}
