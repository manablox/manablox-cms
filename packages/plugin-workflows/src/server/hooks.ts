import type { HookContextBase } from '@manablox/core';

/** What a finished workflow run amounts to, for observers such as audit plugins. */
export interface WorkflowRunSummary {
  runId: string;
  workflowId: string;
  spaceId: string;
  status: 'succeeded' | 'failed' | 'skipped' | 'aborted';
  /** The event that started it, or `schedule` / `manual`. */
  trigger: string;
  /** Started by hand to try the draft, or called from such a run. */
  test: boolean;
}

declare module '@manablox/core' {
  interface ManabloxHooks {
    /** Before a workflow is created, imported or saved enabled, or switched on; throw to refuse it. */
    'workflows:beforeEnable': [
      { spaceId: string; id: string | null; name: string },
      HookContextBase,
    ];
    /** Before a run is queued, test and called runs included; throw to refuse it. */
    'workflows:beforeRun': [
      { spaceId: string; workflowId: string; trigger: string; test: boolean },
      HookContextBase,
    ];
    'workflows:afterRun': [WorkflowRunSummary, HookContextBase];
  }
}
