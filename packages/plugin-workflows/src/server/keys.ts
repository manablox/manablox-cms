import { controlKeys } from '@manablox/core';
import { workflowControls } from './controls.js';

/** The plugin's id. */
export const WORKFLOWS = 'workflows';

/**
 * The control keys the plugin checks, from its declaration: `workflowKeys.feature` (editing and
 * triggering workflows), `features.http` / `mail` (node groups), `limits.active`,
 * `usage.runs`, `rateLimits.concurrency` / `starts`, `retention.runsDays`.
 */
export const workflowKeys = controlKeys(WORKFLOWS, workflowControls);
