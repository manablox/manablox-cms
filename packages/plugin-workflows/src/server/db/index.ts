import { pluginRepos } from '@manablox/db';
import { WorkflowRunRepository } from './runs.js';
import { WorkflowSelectionRepository } from './selection.js';
import { WorkflowRepository } from './workflows.js';

/** The plugin's repositories on one connection or transaction. */
export interface WorkflowRepos {
  workflows: WorkflowRepository;
  runs: WorkflowRunRepository;
  /** The documents a scheduled run looks at. */
  selection: WorkflowSelectionRepository;
}

/**
 * Live-trigger listeners of the process, shared by every connection and transaction, so a
 * change committed through any of them reaches the engine.
 */
const liveListeners = new Set<(spaceId: string) => void>();

/** The plugin's repositories on the connection or transaction `repos` is bound to. */
export const workflowRepos = pluginRepos(
  (context): WorkflowRepos => ({
    workflows: new WorkflowRepository(context, liveListeners),
    runs: new WorkflowRunRepository(context),
    selection: new WorkflowSelectionRepository(context),
  }),
);

export * from './rows.js';
export * from './runs.js';
export * from './selection.js';
export * from './workflows.js';
