import { ManabloxError, type Scope } from '@manablox/core';
import type { Paginated, Pagination } from '@manablox/db';
import { requireInSpace } from '@manablox/services';
import type { WorkflowRunAbort, WorkflowRunStatus, WorkflowTriggerPayload } from '../../../sdk.js';
import type { WorkflowRunFilter, WorkflowRunRow, WorkflowRunSummaryRow } from '../../db/index.js';
import { workflowRepos } from '../../db/index.js';
import { snapshotOf } from '../../versions.js';
import { find, type WorkflowContext } from './context.js';

/** A run as the history lists it: what happened, without its context and outputs. */
export interface WorkflowRunListItem {
  id: string;
  workflowId: string;
  status: WorkflowRunStatus;
  trigger: string;
  version: number | null;
  test: boolean;
  error: string | null;
  /** The key of `error`, for the admin to translate. */
  errorKey: string | null;
  errorParams: Record<string, unknown> | null;
  abort: WorkflowRunRow['abort'];
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  resumeAt: Date | null;
  document: { id: string; title: string | null } | null;
  documents: number;
  caller: { workflowId: string; workflowName: string; runId: string } | null;
  /** Log lines, loop passes included. */
  steps: number;
  /** The first step that failed. */
  failedStep: { key: string; name: string } | null;
}

/** What a test run starts from; see `WorkflowTestSample`. */
export interface WorkflowTestInput {
  contentId?: string | null | undefined;
  input?: Record<string, unknown> | null | undefined;
  payload?: WorkflowTriggerPayload | null | undefined;
  headers?: Record<string, string> | null | undefined;
}

/** Who asks for an abort through the API, and why. */
export interface WorkflowAbortRequest {
  actor: string | null;
  reason?: string | null | undefined;
}

/** A page of the run history, newest first. */
export async function runHistory(
  ctx: WorkflowContext,
  scope: Scope,
  id: string,
  filter: WorkflowRunFilter,
  pagination?: Pagination,
): Promise<Paginated<WorkflowRunListItem>> {
  await find(ctx, scope, id);
  const page = await workflowRepos(ctx.repos).runs.pageSummariesByWorkflow(id, filter, pagination);
  return { ...page, items: page.items.map(listItem) };
}

/** One run, with the definition it walks in `definition`. */
export async function run(ctx: WorkflowContext, scope: Scope, id: string): Promise<WorkflowRunRow> {
  const run = requireInSpace(
    await workflowRepos(ctx.repos).runs.findById(id),
    scope,
    'plugins.workflows.run.notFound',
    { id },
  );
  // Runs carry no environment; their workflow does.
  if (typeof scope !== 'string') {
    const workflow = await workflowRepos(ctx.repos).workflows.findById(run.workflowId);
    if (workflow?.environmentId !== scope.environmentId) {
      throw ManabloxError.notFound('plugins.workflows.run.notFound', { id });
    }
  }
  if (run.definition) return run;
  const workflow = await ctx.engine.definitionFor(run);
  return workflow ? { ...run, definition: snapshotOf(workflow) } : run;
}

/**
 * Test-runs the draft. Event-triggered workflows need a document; called ones take
 * `input`, contributed kinds such as a webhook's a `payload`.
 */
export async function runNow(
  ctx: WorkflowContext,
  scope: Scope,
  id: string,
  test: WorkflowTestInput,
): Promise<WorkflowRunRow> {
  const workflow = await find(ctx, scope, id);
  let document = null;
  if (test.contentId) {
    document = requireInSpace(
      await ctx.repos.content.findById(test.contentId),
      scope,
      'content.notFound',
      { id: test.contentId },
    );
  } else if (workflow.trigger.kind === 'event') {
    throw ManabloxError.badRequest('plugins.workflows.run.documentRequired');
  }
  const started = await ctx.engine.testRun(workflow, {
    document,
    input: test.input ?? null,
    payload: test.payload ?? null,
    headers: test.headers ?? null,
  });
  await ctx.audit.record('workflows.workflow.runNow', workflow, [], {
    runId: started.id,
    status: started.status,
    contentId: document?.id ?? null,
  });
  return started;
}

/**
 * Starts the live version of a workflow with a `manual` trigger, queued like any other run.
 * Its required values must be in `input`.
 */
export async function start(
  ctx: WorkflowContext,
  scope: Scope,
  id: string,
  input: Record<string, unknown>,
): Promise<WorkflowRunRow> {
  const draft = await find(ctx, scope, id);
  const workflow = await workflowRepos(ctx.repos).workflows.findLive(id);
  if (!workflow)
    throw ManabloxError.conflict('plugins.workflows.run.unpublished', { name: draft.name });
  if (workflow.trigger.kind !== 'manual') {
    throw ManabloxError.badRequest('plugins.workflows.run.notManual', { name: workflow.name });
  }
  if (!workflow.enabled) {
    throw ManabloxError.conflict('plugins.workflows.run.disabled', { name: workflow.name });
  }
  const values: Record<string, unknown> = {};
  for (const parameter of workflow.trigger.parameters) {
    const value = input[parameter.name];
    if (parameter.required && (value === undefined || value === null || value === '')) {
      throw ManabloxError.badRequest('plugins.workflows.run.inputMissing', {
        parameter: parameter.name,
      });
    }
    values[parameter.name] = value ?? '';
  }
  const runId = await ctx.engine.startManual(workflow, values);
  await ctx.audit.record('workflows.workflow.start', workflow, [], { runId });
  const started = await workflowRepos(ctx.repos).runs.findById(runId);
  if (!started) throw new ManabloxError('plugins.workflows.run.createFailed');
  return started;
}

/** Aborts one active run. */
export async function abortRun(
  ctx: WorkflowContext,
  scope: Scope,
  runId: string,
  request: WorkflowAbortRequest,
): Promise<WorkflowRunRow> {
  const found = await run(ctx, scope, runId);
  const workflow = await find(ctx, scope, found.workflowId);
  if (!(await ctx.engine.abortRun(workflow, found, apiAbort(request)))) {
    throw ManabloxError.conflict('plugins.workflows.run.notActive', { id: runId });
  }
  return (await workflowRepos(ctx.repos).runs.findById(runId)) ?? found;
}

/** Aborts every active run of a workflow; returns their ids. */
export async function abortRuns(
  ctx: WorkflowContext,
  scope: Scope,
  id: string,
  request: WorkflowAbortRequest,
): Promise<{ aborted: string[] }> {
  const workflow = await find(ctx, scope, id);
  return { aborted: await ctx.engine.abortAll(workflow, apiAbort(request)) };
}

function apiAbort(request: WorkflowAbortRequest): WorkflowRunAbort {
  return {
    source: 'api',
    triggerId: null,
    event: null,
    actor: request.actor,
    reason: request.reason?.trim() || null,
    at: new Date().toISOString(),
  };
}

function listItem(run: WorkflowRunSummaryRow): WorkflowRunListItem {
  return {
    id: run.id,
    workflowId: run.workflowId,
    status: run.status,
    trigger: run.trigger,
    version: run.version,
    test: run.test,
    error: run.error,
    errorKey: run.errorKey,
    errorParams: run.errorParams,
    abort: run.abort,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    resumeAt: run.resumeAt,
    document: run.documentId ? { id: run.documentId, title: run.documentTitle } : null,
    documents: run.documentCount,
    caller: run.caller,
    steps: run.stepCount,
    failedStep: run.failedStep,
  };
}
