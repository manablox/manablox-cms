import {
  copyName,
  diffRecords,
  ManabloxError,
  type Scope,
  scopeSpaceId,
  snapshotChanges,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Paginated, Pagination, Repositories } from '@manablox/db';
import type { CredentialService } from '@manablox/services';
import { hookScope } from '@manablox/services';
import { assertActionsAllowed } from '../actions/index.js';
import { workflowAuditor } from '../audit.js';
import type {
  WorkflowRow,
  WorkflowRunFilter,
  WorkflowRunRow,
  WorkflowSummary,
  WorkflowVersionRow,
} from '../db/index.js';
import { workflowRepos } from '../db/index.js';
import type { WorkflowDesign } from '../design.js';
import type { WorkflowEngine } from '../engine/index.js';
import { workflowKeys } from '../keys.js';
import {
  type ExportedWorkflowEntry,
  readSpaceWorkflows,
  readWorkflowFile,
  type WorkflowFile,
} from '../transfer/index.js';
import { validateWorkflow, type WorkflowInput } from '../validate/index.js';
import {
  catalogOf,
  design,
  type WorkflowCatalog,
  type WorkflowDesigner,
  type WorkflowDesignInput,
} from './workflow/catalog.js';
import {
  assertNotCode,
  environment,
  find,
  spaceLookups,
  WORKFLOW_DIFF,
  type WorkflowContext,
} from './workflow/context.js';
import { exportFile, importSource, type WorkflowImportResult } from './workflow/files.js';
import * as runs from './workflow/runs.js';
import * as versions from './workflow/versions.js';

export type { WorkflowCatalog } from './workflow/catalog.js';
export type { WorkflowImportResult } from './workflow/files.js';
export type {
  WorkflowAbortRequest,
  WorkflowRunListItem,
  WorkflowTestInput,
} from './workflow/runs.js';
export type { WorkflowVersionSummary } from './workflow/versions.js';
export type { WorkflowInput, WorkflowRow, WorkflowRunRow, WorkflowVersionRow };

/** Publishing a save straight away, with a note for the version. */
export interface WorkflowPublishOptions {
  publish?: boolean | undefined;
  note?: string | null | undefined;
}

/** Workflow CRUD and validation; the engine does the running. */
export class WorkflowService {
  private readonly ctx: WorkflowContext;

  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
    private readonly engine: WorkflowEngine,
    /** The vault; `null` outside a management instance. */
    private readonly credentials: CredentialService | null,
  ) {
    this.ctx = {
      manablox,
      repos,
      engine,
      registry: engine.registry,
      credentials,
      audit: workflowAuditor(repos),
    };
  }

  /** This service on other repositories, e.g. a transaction's. */
  using(repos: Repositories): WorkflowService {
    return new WorkflowService(
      this.manablox,
      repos,
      this.engine,
      this.credentials?.using(repos) ?? null,
    );
  }

  /** `workflows:beforeEnable`; a throwing handler refuses the change. */
  private async beforeEnable(scope: Scope, id: string | null, name: string): Promise<void> {
    await this.manablox.hooks.run(
      'workflows:beforeEnable',
      { spaceId: scopeSpaceId(scope), id, name },
      { manablox: this.manablox, ...hookScope(scope) },
    );
    await this.manablox.controls.assertLimit(scope, workflowKeys.limits.active);
  }

  /** Workflow writes and runs need `plugins.workflows`; reads stay open. */
  private assertOn(scope: Scope): Promise<void> {
    return this.manablox.controls.assertFeature(scopeSpaceId(scope), workflowKeys.feature);
  }

  /** Runs `fn` on this service bound to a transaction. */
  private atomic<T>(fn: (service: WorkflowService) => Promise<T>): Promise<T> {
    return this.repos.transaction((repos) => fn(this.using(repos)));
  }

  /** Served so plugin actions and trigger kinds appear in a prebuilt admin. */
  async catalog(scope: Scope | null): Promise<WorkflowCatalog> {
    return catalogOf(this.ctx, scope ? await spaceLookups(this.ctx, scope) : null);
  }

  /** The environment's workflows without their graphs, e.g. to count what points at a record. */
  summaries(scope: Scope): Promise<WorkflowSummary[]> {
    return workflowRepos(this.repos).workflows.listSummariesBySpace(scope);
  }

  /**
   * Designs a workflow from a description, validated like a save and returned unsaved, with
   * the AI plugin's design service; not found while that plugin is missing or off in the space.
   */
  async design(
    input: WorkflowDesignInput,
  ): Promise<WorkflowDesign & { problems: string[]; generationId: string }> {
    const { plugins } = this.manablox;
    // The AI plugin's design service, where it is configured; only its shape is known here.
    const designer = (plugins.get('ai') as { design?: WorkflowDesigner } | undefined)?.design;
    if (!designer || !(await plugins.isOn('ai', input.spaceId))) {
      throw ManabloxError.notFound('plugins.workflows.design.unavailable');
    }
    return design(this.ctx, designer, input);
  }

  /** A page of the space's workflows by name. */
  page(scope: Scope, pagination?: Pagination): Promise<Paginated<WorkflowRow>> {
    return workflowRepos(this.repos).workflows.pageBySpace(scope, pagination);
  }

  get(scope: Scope, id: string): Promise<WorkflowRow> {
    return find(this.ctx, scope, id);
  }

  /** A new draft; triggers run it once published. */
  async create(
    scope: Scope,
    input: WorkflowInput,
    options: WorkflowPublishOptions = {},
  ): Promise<WorkflowRow> {
    await this.assertOn(scope);
    const valid = validateWorkflow(input, await environment(this.ctx, scope), this.ctx.registry);
    await assertActionsAllowed(this.manablox, this.ctx.registry, scopeSpaceId(scope), valid.nodes);
    if (valid.enabled) await this.beforeEnable(scope, null, valid.name);
    // Row, audit entry and any publish land together.
    return this.atomic(async (service) => {
      const row = await service.insert(scope, valid);
      if (!options.publish) return row;
      return (await versions.release(service.ctx, row, options.note)).workflow;
    });
  }

  private async insert(
    scope: Scope,
    valid: ReturnType<typeof validateWorkflow>,
  ): Promise<WorkflowRow> {
    const row = await workflowRepos(this.repos).workflows.create({
      ...scopeFields(scope),
      ...valid,
    });
    await this.ctx.audit.record(
      'workflows.workflow.create',
      row,
      snapshotChanges(row, 'created', WORKFLOW_DIFF),
    );
    return row;
  }

  /** Saves the draft; the published version runs on until the next publish. */
  async update(
    scope: Scope,
    id: string,
    input: WorkflowInput,
    options: WorkflowPublishOptions = {},
  ): Promise<WorkflowRow> {
    // Row, audit entry and any publish land together.
    return this.atomic(async (service) => {
      const row = await service.save(scope, id, input);
      if (!options.publish) return row;
      return (await versions.release(service.ctx, row, options.note)).workflow;
    });
  }

  private async save(scope: Scope, id: string, input: WorkflowInput): Promise<WorkflowRow> {
    const before = await find(this.ctx, scope, id);
    assertNotCode(before);
    await this.assertOn(scope);
    const valid = validateWorkflow(input, await environment(this.ctx, scope), this.ctx.registry);
    await assertActionsAllowed(this.manablox, this.ctx.registry, scopeSpaceId(scope), valid.nodes);
    if (valid.enabled && !before.enabled) await this.beforeEnable(scope, id, valid.name);
    const row = await workflowRepos(this.repos).workflows.update(id, {
      ...valid,
      draftChanged: await versions.differsFromPublished(this.ctx, before, {
        ...valid,
        description: valid.description ?? null,
      }),
    });
    await this.ctx.audit.record(
      'workflows.workflow.update',
      row,
      diffRecords(before, row, WORKFLOW_DIFF),
    );
    return row;
  }

  /** Publishes the draft as the next version, which triggers run from now on. */
  async publish(
    scope: Scope,
    id: string,
    note: string | null = null,
  ): Promise<{ workflow: WorkflowRow; version: WorkflowVersionRow }> {
    await this.assertOn(scope);
    // The version and its audit entry land together.
    return this.repos.transaction((repos) =>
      versions.publish(this.using(repos).ctx, scope, id, note),
    );
  }

  /** Newest first. */
  versions(
    scope: Scope,
    id: string,
    pagination?: Pagination,
  ): Promise<Paginated<versions.WorkflowVersionSummary>> {
    return versions.versions(this.ctx, scope, id, pagination);
  }

  /** One version with its graph. */
  version(scope: Scope, id: string, version: number): Promise<WorkflowVersionRow> {
    return versions.version(this.ctx, scope, id, version);
  }

  /** Copies a version into the draft; publishing it makes it live again as a new version. */
  async restoreVersion(scope: Scope, id: string, version: number): Promise<WorkflowRow> {
    await this.assertOn(scope);
    return this.atomic((service) => versions.restoreVersion(service.ctx, scope, id, version));
  }

  /**
   * Copies a workflow, disabled so it cannot double-fire the original's actions. The copy
   * is always `runtime`.
   */
  async duplicate(scope: Scope, id: string): Promise<WorkflowRow> {
    await this.assertOn(scope);
    return this.atomic((service) => service.copy(scope, id));
  }

  private async copy(scope: Scope, id: string): Promise<WorkflowRow> {
    const source = await find(this.ctx, scope, id);
    const row = await workflowRepos(this.repos).workflows.create({
      ...scopeFields(scope),
      name: copyName(
        source.name,
        (await workflowRepos(this.repos).workflows.listBySpace(scope)).map((entry) => entry.name),
      ),
      description: source.description,
      enabled: false,
      trigger: source.trigger,
      abortTriggers: source.abortTriggers,
      nodes: source.nodes,
      edges: source.edges,
    });
    await this.ctx.audit.record(
      'workflows.workflow.duplicate',
      row,
      snapshotChanges(row, 'created', WORKFLOW_DIFF),
    );
    return row;
  }

  /** Allowed on code workflows too. */
  async setEnabled(scope: Scope, id: string, enabled: boolean): Promise<WorkflowRow> {
    await this.assertOn(scope);
    return this.atomic(async (service) => {
      const { ctx } = service;
      const before = await find(ctx, scope, id);
      if (enabled && !before.enabled) await service.beforeEnable(scope, id, before.name);
      const row = await workflowRepos(ctx.repos).workflows.update(id, { enabled });
      await ctx.audit.record('workflows.workflow.setEnabled', row, [
        { path: 'enabled', from: before.enabled, to: row.enabled },
      ]);
      return row;
    });
  }

  async delete(scope: Scope, id: string): Promise<void> {
    await this.assertOn(scope);
    return this.atomic(async ({ ctx }) => {
      const row = await find(ctx, scope, id);
      assertNotCode(row);
      await workflowRepos(ctx.repos).workflows.delete(id);
      await ctx.audit.record(
        'workflows.workflow.delete',
        row,
        snapshotChanges(row, 'deleted', WORKFLOW_DIFF),
      );
    });
  }

  /** A page of the run history, newest first. */
  runHistory(
    scope: Scope,
    id: string,
    filter: WorkflowRunFilter,
    pagination?: Pagination,
  ): Promise<Paginated<runs.WorkflowRunListItem>> {
    return runs.runHistory(this.ctx, scope, id, filter, pagination);
  }

  /** One run, with the definition it walks in `definition`. */
  run(scope: Scope, id: string): Promise<WorkflowRunRow> {
    return runs.run(this.ctx, scope, id);
  }

  /**
   * Test-runs the draft. Event-triggered workflows need a document; called ones take
   * `input`, those of a contributed kind a `payload` where it reads one.
   */
  async runNow(
    scope: Scope,
    id: string,
    test: runs.WorkflowTestInput = {},
  ): Promise<WorkflowRunRow> {
    await this.assertOn(scope);
    return runs.runNow(this.ctx, scope, id, test);
  }

  /** Starts the live version of a manual workflow; required values must be in `input`. */
  async start(
    scope: Scope,
    id: string,
    input: Record<string, unknown> = {},
  ): Promise<WorkflowRunRow> {
    await this.assertOn(scope);
    return runs.start(this.ctx, scope, id, input);
  }

  /** Aborts one active run. */
  abortRun(
    scope: Scope,
    runId: string,
    request: runs.WorkflowAbortRequest,
  ): Promise<WorkflowRunRow> {
    return runs.abortRun(this.ctx, scope, runId, request);
  }

  /** Aborts every active run of a workflow; returns their ids. */
  abortRuns(
    scope: Scope,
    id: string,
    request: runs.WorkflowAbortRequest,
  ): Promise<{ aborted: string[] }> {
    return runs.abortRuns(this.ctx, scope, id, request);
  }

  /** The draft, or a version, as a portable file with the records and credential slots it uses. */
  export(scope: Scope, id: string, version: number | null = null): Promise<WorkflowFile> {
    return exportFile(this.ctx, scope, id, version);
  }

  /**
   * Creates a disabled workflow from a file. Credentials and the records its triggers point
   * at (such as incoming endpoints) are matched by slug; missing ones are created, switched
   * off or as empty slots. Workflows it runs are matched by slug, then by name; a call node
   * whose target is missing is emptied.
   */
  async import(scope: Scope, raw: unknown): Promise<WorkflowImportResult> {
    await this.assertOn(scope);
    const file = readWorkflowFile(raw, this.ctx.registry);
    // Endpoints, credentials and the workflow land together, or not at all.
    return this.repos.transaction(async (repos) => {
      const { workflows, notes } = await importSource(
        this.using(repos).ctx,
        scope,
        file,
        'workflows.workflow.import',
      );
      return { workflow: workflows[0] as WorkflowRow, notes };
    });
  }

  /** A space import's workflows, on its transaction; their ids are kept. */
  async importSpace(
    repos: Repositories,
    scope: Scope,
    entries: readonly ExportedWorkflowEntry[],
    /** The file's rows of a section, e.g. `credentials`, restored with the space or not. */
    carried: (kind: string) => readonly unknown[] = () => [],
  ): Promise<{ notes: string[] }> {
    await this.assertOn(scope);
    const { notes } = await importSource(
      this.using(repos).ctx,
      scope,
      readSpaceWorkflows(entries, this.ctx.registry, carried),
      'space.import',
      (_kind, id) => id,
    );
    return { notes };
  }
}

/** A new row's space and environment; the space's production environment for a space id. */
function scopeFields(scope: Scope): { spaceId: string; environmentId?: string } {
  return typeof scope === 'string'
    ? { spaceId: scope }
    : { spaceId: scope.spaceId, environmentId: scope.environmentId };
}
