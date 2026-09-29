import { sameValue } from '@manablox/core';
import type { WorkflowSnapshot } from '../sdk.js';

/** The parts of a workflow a version freezes. */
export function snapshotOf(row: WorkflowSnapshot): WorkflowSnapshot {
  return {
    name: row.name,
    description: row.description,
    trigger: row.trigger,
    abortTriggers: row.abortTriggers,
    nodes: row.nodes,
    edges: row.edges,
  };
}

/** Whether two snapshots define the same workflow. */
export const sameSnapshot = (a: WorkflowSnapshot, b: WorkflowSnapshot): boolean =>
  sameValue(snapshotOf(a), snapshotOf(b));
