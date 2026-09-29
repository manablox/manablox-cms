import { ManabloxError, type RunFailure } from '@manablox/core';
import {
  type AgeCutoff,
  batches,
  type DatabaseContext,
  firstPage,
  type Paginated,
  type Pagination,
  paginate,
  Repository,
} from '@manablox/db';
import {
  and,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNull,
  lte,
  notInArray,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { WorkflowRunAbort } from '../../sdk/abort.js';
import {
  runStatusesInto,
  WORKFLOW_ACTIVE_RUN_STATUSES,
  type WorkflowNodeLog,
  type WorkflowRunCaller,
  type WorkflowRunContext,
  type WorkflowRunState,
  type WorkflowRunStatus,
} from '../../sdk/run.js';
import type { WorkflowSnapshot } from '../../sdk/workflow.js';
import { type WorkflowRunRow, type WorkflowTables, workflowTables } from './rows.js';

/** Waiting runs one sweep resumes. */
export const DUE_RUN_BATCH = 100;

export interface WorkflowRunCreateData {
  workflowId: string;
  spaceId: string;
  trigger: string;
  context: WorkflowRunContext;
  /** The published version it runs. */
  version?: number | null | undefined;
  test?: boolean | undefined;
  /** The draft a test run walks. */
  definition?: WorkflowSnapshot | null | undefined;
}

export interface WorkflowRunFilter {
  status?: WorkflowRunStatus[] | undefined;
  /** Only test runs, or only the others; both when absent. */
  test?: boolean | undefined;
}

/** Runs kept per workflow; older finished ones are pruned by `prune`. */
const RUNS_KEPT_PER_WORKFLOW = 200;

/** A run without its context, state, log and definition. */
export type WorkflowRunSummaryRow = Omit<
  WorkflowRunRow,
  'context' | 'state' | 'log' | 'definition'
>;

/** An active run with what aborting it reads. */
export type ActiveWorkflowRun = Pick<
  WorkflowRunRow,
  'id' | 'workflowId' | 'status' | 'trigger' | 'test' | 'context' | 'state'
>;

/** The history columns a run's context yields. */
function contextSummary(context: WorkflowRunContext) {
  const content = context.content as { id?: unknown; title?: unknown } | null;
  const document = content && typeof content.id === 'string' ? content : null;
  const caller: WorkflowRunCaller | null | undefined = context.caller;
  return {
    documentId: document ? (document.id as string) : null,
    documentTitle: document && typeof document.title === 'string' ? document.title : null,
    documentCount: context.documents?.length ?? 0,
    caller: caller
      ? { workflowId: caller.workflowId, workflowName: caller.workflowName, runId: caller.runId }
      : null,
  };
}

/** The history columns a run's log yields. */
function logSummary(log: WorkflowNodeLog[]) {
  const failed = log.find((entry) => entry.status === 'failed');
  return {
    stepCount: log.length,
    failedStep: failed ? { key: failed.key, name: failed.name } : null,
  };
}

/** Workflow runs: their queue states, logs and history. */
export class WorkflowRunRepository extends Repository<WorkflowTables> {
  constructor(context: DatabaseContext) {
    super(context, workflowTables(context));
  }

  async create(data: WorkflowRunCreateData): Promise<WorkflowRunRow> {
    const [row] = await this.createMany([data]);
    if (!row) throw new ManabloxError('plugins.workflows.run.createFailed');
    return row;
  }

  /** Queued runs, inserted in as few statements as the parameter limit allows, in order. */
  async createMany(list: readonly WorkflowRunCreateData[]): Promise<WorkflowRunRow[]> {
    if (list.length === 0) return [];
    const { workflowRuns } = this.t;
    const values = list.map((data) => ({
      workflowId: data.workflowId,
      spaceId: data.spaceId,
      trigger: data.trigger,
      context: data.context,
      version: data.version ?? null,
      test: data.test ?? false,
      definition: data.definition ?? null,
      status: 'queued' as const,
      ...contextSummary(data.context),
    }));
    const columns = Object.keys(values[0] ?? {}).length;
    const out: WorkflowRunRow[] = [];
    for (const batch of batches(values, columns, this.dialect.maxParameters)) {
      const rows = await this.db
        .insert(workflowRuns)
        .values([...batch])
        .returning();
      if (rows.length !== batch.length) {
        throw new ManabloxError('plugins.workflows.run.createFailed');
      }
      out.push(...rows);
    }
    return out;
  }

  findById(id: string): Promise<WorkflowRunRow | null> {
    return this.findOne(this.t.workflowRuns, id);
  }

  /** A page of a workflow's runs, newest first. */
  pageByWorkflow(
    workflowId: string,
    filter: WorkflowRunFilter = {},
    pagination: Pagination = firstPage(),
  ): Promise<Paginated<WorkflowRunRow>> {
    const { workflowRuns } = this.t;
    return this.paginate(
      workflowRuns,
      this.runFilter(workflowId, filter),
      [desc(workflowRuns.createdAt), desc(workflowRuns.id)],
      pagination,
    );
  }

  /** `pageByWorkflow` without contexts, states, logs and definitions. */
  pageSummariesByWorkflow(
    workflowId: string,
    filter: WorkflowRunFilter = {},
    pagination: Pagination = firstPage(),
  ): Promise<Paginated<WorkflowRunSummaryRow>> {
    const { workflowRuns } = this.t;
    const {
      context: _context,
      state: _state,
      log: _log,
      definition: _definition,
      ...columns
    } = getTableColumns(workflowRuns);
    return paginate<WorkflowRunSummaryRow>(this.db, workflowRuns, {
      columns,
      where: this.runFilter(workflowId, filter),
      orderBy: [desc(workflowRuns.createdAt), desc(workflowRuns.id)],
      pagination,
    });
  }

  private runFilter(workflowId: string, filter: WorkflowRunFilter): SQL | undefined {
    const { workflowRuns } = this.t;
    return and(
      eq(workflowRuns.workflowId, workflowId),
      filter.status?.length ? inArray(workflowRuns.status, filter.status) : undefined,
      filter.test === undefined ? undefined : eq(workflowRuns.test, filter.test),
    );
  }

  /** Moves a run to `running`; `null` if already taken. The status predicate is the lock. */
  async claim(id: string): Promise<WorkflowRunRow | null> {
    const { workflowRuns } = this.t;
    const rows = await this.db
      .update(workflowRuns)
      .set({
        status: 'running',
        startedAt: sql`coalesce(${workflowRuns.startedAt}, ${this.dialect.now()})`,
      })
      .where(and(eq(workflowRuns.id, id), inArray(workflowRuns.status, runStatusesInto('running'))))
      .returning();
    return rows[0] ?? null;
  }

  /** A workflow's queued, running and waiting runs, oldest first. */
  async listActiveByWorkflow(workflowId: string): Promise<ActiveWorkflowRun[]> {
    const { workflowRuns } = this.t;
    return this.db
      .select({
        id: workflowRuns.id,
        workflowId: workflowRuns.workflowId,
        status: workflowRuns.status,
        trigger: workflowRuns.trigger,
        test: workflowRuns.test,
        context: workflowRuns.context,
        state: workflowRuns.state,
      })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.workflowId, workflowId),
          inArray(workflowRuns.status, [...WORKFLOW_ACTIVE_RUN_STATUSES]),
        ),
      )
      .orderBy(workflowRuns.createdAt);
  }

  /** Moves an active run to `aborted`; the status it left, or `null` if it had already ended. */
  async abort(id: string, abort: WorkflowRunAbort): Promise<WorkflowRunStatus | null> {
    const { workflowRuns } = this.t;
    // `abort.from` records the status the update replaced; the predicate makes a race lose cleanly.
    const [row] = await this.db
      .update(workflowRuns)
      .set({
        status: 'aborted',
        abort: sql`${this.dialect.jsonObjectWith(abort, 'from', workflowRuns.status)}`,
        resumeAt: null,
        finishedAt: new Date(),
      })
      .where(and(eq(workflowRuns.id, id), inArray(workflowRuns.status, runStatusesInto('aborted'))))
      .returning({ abort: workflowRuns.abort });
    return row?.abort?.from ?? null;
  }

  async findStatus(id: string): Promise<WorkflowRunStatus | null> {
    const { workflowRuns } = this.t;
    const [row] = await this.db
      .select({ status: workflowRuns.status })
      .from(workflowRuns)
      .where(eq(workflowRuns.id, id));
    return row?.status ?? null;
  }

  /** Waiting runs whose resume time has passed, outside `skipSpaceIds`. */
  async listDue(
    now: Date,
    skipSpaceIds: readonly string[] = [],
    limit = DUE_RUN_BATCH,
  ): Promise<Array<{ id: string; spaceId: string }>> {
    const { workflowRuns } = this.t;
    return this.db
      .select({ id: workflowRuns.id, spaceId: workflowRuns.spaceId })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.status, 'waiting'),
          lte(workflowRuns.resumeAt, now),
          skipSpaceIds.length ? notInArray(workflowRuns.spaceId, [...skipSpaceIds]) : undefined,
        ),
      )
      .orderBy(workflowRuns.resumeAt)
      .limit(limit);
  }

  /** Makes a run that waits for its called run due at `at`, so the clock picks it up. */
  async wakeAt(id: string, at: Date): Promise<void> {
    const { workflowRuns } = this.t;
    await this.db
      .update(workflowRuns)
      .set({ resumeAt: at })
      .where(
        and(
          eq(workflowRuns.id, id),
          eq(workflowRuns.status, 'waiting'),
          isNull(workflowRuns.resumeAt),
        ),
      );
  }

  /**
   * Moves a running run to `status`; false when the transition table refuses it, as for a
   * run aborted meanwhile, whose log `saveLog` writes instead.
   */
  async saveProgress(
    id: string,
    data: {
      status: WorkflowRunStatus;
      state: WorkflowRunState;
      log: WorkflowNodeLog[];
      error?: RunFailure | null | undefined;
      resumeAt?: Date | null | undefined;
      finished?: boolean | undefined;
    },
  ): Promise<boolean> {
    const { workflowRuns } = this.t;
    const rows = await this.db
      .update(workflowRuns)
      .set({
        status: data.status,
        state: data.state,
        log: data.log,
        ...logSummary(data.log),
        error: data.error?.message ?? null,
        errorKey: data.error?.key ?? null,
        errorParams: data.error?.key ? (data.error.params ?? {}) : null,
        resumeAt: data.resumeAt ?? null,
        ...(data.finished ? { finishedAt: new Date() } : {}),
      })
      .where(
        and(eq(workflowRuns.id, id), inArray(workflowRuns.status, runStatusesInto(data.status))),
      )
      .returning({ id: workflowRuns.id });
    return rows.length > 0;
  }

  /** What an aborted run did before it stopped. */
  async saveLog(id: string, state: WorkflowRunState, log: WorkflowNodeLog[]): Promise<void> {
    const { workflowRuns } = this.t;
    await this.db
      .update(workflowRuns)
      .set({ state, log, ...logSummary(log) })
      .where(and(eq(workflowRuns.id, id), eq(workflowRuns.status, 'aborted')));
  }

  /**
   * Deletes finished runs beyond the newest `keep` of every workflow. With `age`, deletes
   * instead up to `age.limit` finished runs of the space older than `age.before`, and returns
   * how many went.
   */
  async prune(keep = RUNS_KEPT_PER_WORKFLOW, age?: AgeCutoff): Promise<number> {
    const { workflowRuns } = this.t;
    const finished = notInArray(workflowRuns.status, [...WORKFLOW_ACTIVE_RUN_STATUSES]);
    if (age) return this.pruneAged(workflowRuns, age, finished);
    await this.keepNewest(workflowRuns, {
      partition: workflowRuns.workflowId,
      keep,
      removable: finished,
    });
    return 0;
  }
}
