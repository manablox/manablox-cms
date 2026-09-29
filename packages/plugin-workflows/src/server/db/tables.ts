import type { AuditActor, ResourceSource } from '@manablox/core';
import {
  boolean,
  environmentId,
  id,
  index,
  integer,
  json,
  spaces,
  table,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from '@manablox/db/definitions';
import { sql } from 'drizzle-orm';
import type { WorkflowAbortTrigger, WorkflowRunAbort } from '../../sdk/abort.js';
import type {
  WorkflowNodeLog,
  WorkflowRunCaller,
  WorkflowRunContext,
  WorkflowRunState,
  WorkflowRunStatus,
} from '../../sdk/run.js';
import type {
  WorkflowEdge,
  WorkflowNode,
  WorkflowSnapshot,
  WorkflowTrigger,
} from '../../sdk/workflow.js';

/**
 * A triggered graph of actions; trigger and graph are JSON so new actions need no migration.
 * The row is the draft; triggers run its published version from `workflows_versions`.
 */
export const workflows = table(
  'workflows',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces, 'id', { onDelete: 'cascade' }),
    environmentId: environmentId(),
    name: text().notNull(),
    /** Machine name code declarations match on; empty for admin-made workflows. */
    slug: text().notNull().default(''),
    /** `code` rows are reconciled from the config and read-only elsewhere. */
    source: text<ResourceSource>().notNull().default('runtime'),
    /** Which plugin declared it, or `config`. */
    sourceRef: text(),
    description: text(),
    enabled: boolean().notNull().default(false),
    trigger: json<WorkflowTrigger>().notNull(),
    /** Events and calls that stop active runs. */
    abortTriggers: json<WorkflowAbortTrigger[]>().notNull().default([]),
    nodes: json<WorkflowNode[]>().notNull().default([]),
    edges: json<WorkflowEdge[]>().notNull().default([]),
    /** The version triggers run; null until first published. */
    publishedVersion: integer(),
    /** The published version's trigger kind, so dispatch filters without reading JSON. */
    triggerKind: text<WorkflowTrigger['kind'] | (string & Record<never, never>)>(),
    publishedAt: timestamp(),
    /** The draft differs from the published version. */
    draftChanged: boolean().notNull().default(false),
    /** The minute last claimed, so concurrent ticks start one run. */
    lastScheduledAt: timestamp(),
    lastRunAt: timestamp(),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => [
    index('workflows_space_idx').on(t.spaceId, t.enabled, t.triggerKind),
    // The scheduler reads live schedule workflows across spaces.
    index('workflows_trigger_kind_idx').on(t.triggerKind, t.enabled),
    // Partial: admin-made workflows all have an empty slug.
    uniqueIndex('workflows_environment_slug_key')
      .on(t.environmentId, t.slug)
      .where(sql`${t.slug} <> ''`),
  ],
);

/** A published snapshot of a workflow; runs name the version they ran. */
export const workflowVersions = table(
  'workflows_versions',
  {
    id: id(),
    workflowId: uuid()
      .notNull()
      .references(() => workflows, 'id', { onDelete: 'cascade' }),
    /** From 1, per workflow. */
    version: integer().notNull(),
    name: text().notNull(),
    description: text(),
    trigger: json<WorkflowTrigger>().notNull(),
    abortTriggers: json<WorkflowAbortTrigger[]>().notNull().default([]),
    nodes: json<WorkflowNode[]>().notNull().default([]),
    edges: json<WorkflowEdge[]>().notNull().default([]),
    /** What changed, in the publisher's words. */
    note: text(),
    publishedBy: json<AuditActor>(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [uniqueIndex('workflows_versions_workflow_version_key').on(t.workflowId, t.version)],
);

/** One execution, with the context, state and log needed to resume. */
export const workflowRuns = table(
  'workflows_runs',
  {
    id: id(),
    workflowId: uuid()
      .notNull()
      .references(() => workflows, 'id', { onDelete: 'cascade' }),
    spaceId: uuid()
      .notNull()
      .references(() => spaces, 'id', { onDelete: 'cascade' }),
    /** The event name, or `schedule` / `manual`. */
    trigger: text().notNull(),
    /** The published version it runs; null on a test run of the draft. */
    version: integer(),
    /** Started by hand to try the draft, or called from such a run. */
    test: boolean().notNull().default(false),
    /** The draft a test run walks, frozen when it started. */
    definition: json<WorkflowSnapshot>(),
    status: text<WorkflowRunStatus>().notNull().default('queued'),
    context: json<WorkflowRunContext>().notNull(),
    /** See `WorkflowRunState`. */
    state: json<WorkflowRunState>()
      .notNull()
      .default({ outputs: {}, fired: [], dead: [], ready: [], done: [] }),
    log: json<WorkflowNodeLog[]>().notNull().default([]),
    error: text(),
    /** The error key of `error`, for the admin to translate; null when it has none. */
    errorKey: text(),
    errorParams: json<Record<string, unknown>>(),
    /** Set on an `aborted` run: what stopped it. */
    abort: json<WorkflowRunAbort>(),
    /** Set while `waiting`: when to resume. */
    resumeAt: timestamp(),
    /** Log lines, loop passes included; kept with the log for the history list. */
    stepCount: integer().notNull().default(0),
    /** The first node that failed. */
    failedStep: json<{ key: string; name: string }>(),
    /** The document the run is about, from the context. */
    documentId: text(),
    documentTitle: text(),
    /** Documents a scheduled run selected. */
    documentCount: integer().notNull().default(0),
    /** The run that called this one. */
    caller: json<Pick<WorkflowRunCaller, 'workflowId' | 'workflowName' | 'runId'>>(),
    startedAt: timestamp(),
    finishedAt: timestamp(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [
    index('workflows_runs_workflow_idx').on(t.workflowId, t.createdAt),
    index('workflows_runs_resume_idx').on(t.status, t.resumeAt),
    index('workflows_runs_space_idx').on(t.spaceId),
  ],
);
