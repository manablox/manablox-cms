import { type AuditActor, diffRecords, ManabloxError, type Scope, scopeOf } from '@manablox/core';
import { currentActor } from '@manablox/core/node';
import type { Paginated, Pagination } from '@manablox/db';
import type { WorkflowSnapshot } from '../../../sdk.js';
import {
  type WorkflowRow,
  type WorkflowVersionRow,
  withVersion,
  workflowRepos,
} from '../../db/index.js';
import { validateWorkflow } from '../../validate/index.js';
import { sameSnapshot, snapshotOf } from '../../versions.js';
import {
  assertNotCode,
  environment,
  find,
  WORKFLOW_DIFF,
  type WorkflowContext,
} from './context.js';

/** A published version, without its graph. */
export interface WorkflowVersionSummary {
  version: number;
  name: string;
  note: string | null;
  /** Who published it; null for versions made on upgrade. */
  publishedBy: AuditActor | null;
  createdAt: Date;
  nodes: number;
  /** The version triggers run. */
  live: boolean;
}

/** Publishes the draft as the next version, which triggers run from now on. */
export async function publish(
  ctx: WorkflowContext,
  scope: Scope,
  id: string,
  note: string | null,
): Promise<{ workflow: WorkflowRow; version: WorkflowVersionRow }> {
  const row = await find(ctx, scope, id);
  assertNotCode(row);
  // The space may have changed since the save, e.g. a credential was removed.
  validateWorkflow(
    { ...snapshotOf(row), enabled: row.enabled },
    await environment(ctx, scope),
    ctx.registry,
  );
  return release(ctx, row, note);
}

/** Newest first. */
export async function versions(
  ctx: WorkflowContext,
  scope: Scope,
  id: string,
  pagination?: Pagination,
): Promise<Paginated<WorkflowVersionSummary>> {
  const workflow = await find(ctx, scope, id);
  const page = await workflowRepos(ctx.repos).workflows.pageVersions(id, pagination);
  return {
    ...page,
    items: page.items.map(({ nodeCount, ...row }) => ({
      ...row,
      nodes: nodeCount,
      live: row.version === workflow.publishedVersion,
    })),
  };
}

/** One version with its graph. */
export async function version(
  ctx: WorkflowContext,
  scope: Scope,
  id: string,
  version: number,
): Promise<WorkflowVersionRow> {
  const workflow = await find(ctx, scope, id);
  const row = await workflowRepos(ctx.repos).workflows.findVersion(id, version);
  if (!row) throw ManabloxError.notFound('plugins.workflows.version.notFound', { id, version });
  // A version made on upgrade from a step chain has its graph on the workflow.
  if (!row.nodes.length) {
    const { nodes, edges } = withVersion(workflow, row);
    return { ...row, nodes, edges };
  }
  return row;
}

/** Copies a version into the draft; publishing it makes it live again as a new version. */
export async function restoreVersion(
  ctx: WorkflowContext,
  scope: Scope,
  id: string,
  number: number,
): Promise<WorkflowRow> {
  const before = await find(ctx, scope, id);
  assertNotCode(before);
  const snapshot = snapshotOf(await version(ctx, scope, id, number));
  const row = await workflowRepos(ctx.repos).workflows.update(id, {
    ...snapshot,
    draftChanged: await differsFromPublished(ctx, before, snapshot),
  });
  await ctx.audit.record(
    'workflows.workflow.restoreVersion',
    row,
    diffRecords(before, row, WORKFLOW_DIFF),
    {
      version: number,
    },
  );
  return row;
}

/** Freezes the row's draft as the next version. */
export async function release(
  ctx: WorkflowContext,
  row: WorkflowRow,
  note: string | null | undefined,
): Promise<{ workflow: WorkflowRow; version: WorkflowVersionRow }> {
  const trimmed = note?.trim() || null;
  const version = await workflowRepos(ctx.repos).workflows.publish(row.id, {
    definition: snapshotOf(row),
    note: trimmed,
    publishedBy: currentActor(),
  });
  const workflow = await find(ctx, scopeOf(row), row.id);
  await ctx.audit.record(
    'workflows.workflow.publish',
    workflow,
    row.publishedVersion === null
      ? []
      : [{ path: 'publishedVersion', from: row.publishedVersion, to: version.version }],
    { version: version.version, note: trimmed },
  );
  return { workflow, version };
}

/** Whether a draft differs from what is published; false while nothing is. */
export async function differsFromPublished(
  ctx: WorkflowContext,
  row: WorkflowRow,
  draft: WorkflowSnapshot,
): Promise<boolean> {
  if (row.publishedVersion === null) return false;
  const published = await workflowRepos(ctx.repos).workflows.findVersion(
    row.id,
    row.publishedVersion,
  );
  return !published || !sameSnapshot(withVersion(row, published), draft);
}
