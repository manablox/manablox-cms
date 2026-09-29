import type { Manablox } from '@manablox/core/node';
import type { Repositories } from '@manablox/db';
import type { WorkflowRunEndStatus } from '../sdk.js';
import { runAuditor } from './audit.js';
import type { WorkflowRow, WorkflowRunRow } from './db/index.js';

/** A workflow as aborting and reporting name it. */
export type WorkflowRef = Pick<WorkflowRow, 'id' | 'spaceId' | 'name'>;

/** What reporting an ended run reads of it. */
export type EndedRun = Pick<WorkflowRunRow, 'id' | 'trigger' | 'test' | 'context'>;

/** Reports ended runs; the repository's guarded writes decide which caller reports. */
export class RunLifecycle {
  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Pick<Repositories, 'audit'>,
    /** Wakes the run that waits for this one. */
    private readonly resumeCaller: (run: EndedRun) => Promise<void>,
  ) {}

  /** Audits the end, runs `workflows:afterRun` and wakes a waiting caller; once per run. */
  async reportEnded(
    workflow: WorkflowRef,
    run: EndedRun,
    status: WorkflowRunEndStatus,
    meta: Record<string, unknown>,
  ): Promise<void> {
    await runAuditor(this.repos).record(
      status === 'aborted' ? 'workflows.run.abort' : 'workflows.run.finish',
      { id: run.id, spaceId: workflow.spaceId, workflowName: workflow.name },
      undefined,
      { workflowId: workflow.id, ...meta },
    );
    // The hook bus logs a handler that throws; the run still ends and wakes its caller.
    await this.manablox.hooks
      .run(
        'workflows:afterRun',
        {
          runId: run.id,
          workflowId: workflow.id,
          spaceId: workflow.spaceId,
          status,
          trigger: run.trigger,
          test: run.test,
        },
        { manablox: this.manablox, spaceId: workflow.spaceId },
      )
      .catch(() => undefined);
    await this.resumeCaller(run);
  }
}
