import { type Scope, scopeSpaceId, snapshotChanges } from '@manablox/core';
import { hookScope } from '@manablox/services';
import type { WorkflowTriggerContext } from '../../../define/triggers.js';
import type { WorkflowSnapshot } from '../../../sdk.js';
import { type WorkflowRow, withVersion, workflowRepos } from '../../db/index.js';
import { workflowKeys } from '../../keys.js';
import {
  buildWorkflowFile,
  fileLists,
  fileOf,
  type PlanImportOptions,
  type PlannedWorkflow,
  planImport,
  triggerRefsOf,
  type WorkflowFile,
  type WorkflowImportSource,
} from '../../transfer/index.js';
import { type ValidationEnvironment, validateWorkflow } from '../../validate/index.js';
import {
  environmentOf,
  find,
  spaceLookups,
  vault,
  WORKFLOW_DIFF,
  type WorkflowContext,
} from './context.js';
import { release, version as versionOf } from './versions.js';

/** A new workflow from a file, and what the import had to change or create to fit this space. */
export interface WorkflowImportResult {
  workflow: WorkflowRow;
  notes: string[];
}

/**
 * The draft, or a version, as a portable file with the credential slots it uses and the
 * records its triggers point at, such as incoming endpoints.
 */
export async function exportFile(
  ctx: WorkflowContext,
  scope: Scope,
  id: string,
  version: number | null,
): Promise<WorkflowFile> {
  const [draft, lookups] = await Promise.all([find(ctx, scope, id), spaceLookups(ctx, scope)]);
  const workflow =
    version === null ? draft : withVersion(draft, await versionOf(ctx, scope, id, version));
  const context: WorkflowTriggerContext = { manablox: ctx.manablox, repos: ctx.repos, scope };
  const exported: Parameters<typeof buildWorkflowFile>[2] = {};
  for (const [list, ids] of triggerRefsOf(ctx.registry, workflow)) {
    const writer = fileOf(ctx.registry, list);
    if (writer) exported[list] = await writer.export(context, [...ids]);
  }
  const file = buildWorkflowFile(
    workflow,
    lookups.credentials,
    exported,
    lookups.workflows,
    ctx.registry,
    new Date(),
  );
  await ctx.audit.record(
    'workflows.workflow.export',
    workflow,
    [],
    version === null ? null : { version },
  );
  return file;
}

/** Plans and validates every workflow, then writes; call with a transaction's context. */
export async function importSource(
  ctx: WorkflowContext,
  scope: Scope,
  source: WorkflowFile | WorkflowImportSource,
  via: 'workflows.workflow.import' | 'space.import',
  newId?: PlanImportOptions['newId'],
): Promise<{ workflows: WorkflowRow[]; notes: string[] }> {
  const lookups = await spaceLookups(ctx, scope);
  const env = environmentOf(ctx, lookups);
  const context: WorkflowTriggerContext = { manablox: ctx.manablox, repos: ctx.repos, scope };
  const records: Record<string, Array<{ id: string; slug: string }>> = {};
  for (const list of fileLists(ctx.registry)) {
    records[list] = (await fileOf(ctx.registry, list)?.existing(context)) ?? [];
  }
  const plan = planImport(
    source,
    { credentials: lookups.credentials, records, workflows: lookups.workflows },
    { typeExists: env.typeExists, registry: ctx.registry, newId },
  );

  // Rows the plan creates count as present.
  const kinds = new Map(plan.credentials.map((row) => [row.id, row.kind]));
  const created = new Map(
    Object.entries(plan.records).map(([list, rows]) => [list, new Set(rows.map((row) => row.id))]),
  );
  const triggers = new Map(plan.workflows.map((row) => [row.id, row.draft.trigger]));
  const planned: ValidationEnvironment = {
    ...env,
    credentialKind: (id) => kinds.get(id) ?? env.credentialKind(id),
    plannedRecords: (list) => created.get(list) ?? new Set(),
    workflowTrigger: (id) => triggers.get(id) ?? env.workflowTrigger(id),
  };
  // Only a draft the plan switched off for a missing call target may keep it empty.
  const validate = (snapshot: WorkflowSnapshot, entry: PlannedWorkflow) =>
    validateWorkflow(
      { ...snapshot, enabled: entry.enabled },
      { ...planned, emptyCallTargets: entry.missingCallTarget },
      ctx.registry,
    );
  const valid = plan.workflows.map((entry) => ({
    entry,
    draft: validate(entry.draft, entry),
    live: entry.publish && entry.live ? validate(entry.live, entry) : null,
  }));

  // The whole file at once, not one row at a time.
  const enabled = valid.filter(({ draft, live }) => (live ?? draft).enabled).length;
  if (enabled > 0) {
    await ctx.manablox.controls.assertLimit(scope, workflowKeys.limits.active, {
      increment: enabled,
    });
  }
  for (const [list, rows] of Object.entries(plan.records)) {
    const limit = fileOf(ctx.registry, list)?.limit;
    if (limit && rows.length > 0) {
      await ctx.manablox.controls.assertLimit(scope, limit, { increment: rows.length });
    }
  }
  // A space import runs them before it writes anything.
  for (const { entry, draft, live } of via === 'space.import' ? [] : valid) {
    const row = live ?? draft;
    if (!row.enabled) continue;
    await ctx.manablox.hooks.run(
      'workflows:beforeEnable',
      { spaceId: scopeSpaceId(scope), id: entry.id, name: row.name },
      { manablox: ctx.manablox, ...hookScope(scope) },
    );
  }
  for (const credential of plan.credentials) {
    await vault(ctx).createSlot(scopeSpaceId(scope), credential, via);
  }
  for (const [list, rows] of Object.entries(plan.records)) {
    if (rows.length) await fileOf(ctx.registry, list)?.write({ ...context, via }, rows);
  }

  const workflows: WorkflowRow[] = [];
  for (const { entry, draft, live } of valid) {
    // The published definition goes first so it becomes the version.
    let row = await workflowRepos(ctx.repos).workflows.create({
      id: entry.id,
      spaceId: scopeSpaceId(scope),
      ...(typeof scope === 'string' ? {} : { environmentId: scope.environmentId }),
      ...(live ?? draft),
    });
    await ctx.audit.record(
      'workflows.workflow.import',
      row,
      snapshotChanges(row, 'created', WORKFLOW_DIFF),
      {
        via,
        credentialsCreated: plan.credentials.length,
        ...Object.fromEntries(
          Object.entries(plan.records).map(([list, rows]) => [`${list}Created`, rows.length]),
        ),
        notes: plan.notes.length,
      },
    );
    if (entry.publish) {
      const note = via === 'space.import' ? 'Imported with the space' : null;
      row = (await release(ctx, row, note)).workflow;
    }
    if (live)
      row = await workflowRepos(ctx.repos).workflows.update(row.id, {
        ...draft,
        draftChanged: true,
      });
    workflows.push(row);
  }
  return { workflows, notes: plan.notes };
}
