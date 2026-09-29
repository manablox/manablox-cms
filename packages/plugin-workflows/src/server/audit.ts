import { type AuditActor, type AuditSink, auditor, type PluginAudit } from '@manablox/core';
import type { WorkflowRow } from './db/index.js';

/** The audit entities of workflows and their runs. */
const WORKFLOW_ENTITY = 'workflows.workflow';
const RUN_ENTITY = 'workflows.run';

/** Workflows and their runs in the activity log; a run records as the `workflows` actor. */
export const workflowAudit: PluginAudit = {
  entities: [WORKFLOW_ENTITY, RUN_ENTITY],
  actorKinds: ['workflows'],
};

/** Entries on workflows, named by the workflow; as `actor` when given, e.g. the code sync. */
export const workflowAuditor = (sink: AuditSink, actor?: AuditActor) =>
  auditor(sink, WORKFLOW_ENTITY, (workflow: WorkflowRow) => workflow.name, actor ? { actor } : {});

/** Entries on runs, named by their workflow. */
export const runAuditor = (sink: AuditSink) =>
  auditor(
    sink,
    RUN_ENTITY,
    (run: { id: string; spaceId: string; workflowName: string }) => run.workflowName,
  );
