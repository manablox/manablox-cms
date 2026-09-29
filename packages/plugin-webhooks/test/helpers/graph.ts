import type { ContentEvent } from '@manablox/core';
import {
  WORKFLOW_NODE_SPECS,
  WORKFLOW_TRIGGER_ID,
  WORKFLOW_TRIGGER_PORTS,
  type WorkflowAbortTrigger,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowTrigger,
} from '@manablox/plugin-workflows/sdk';

let nodeSeq = 0;
let edgeSeq = 0;

/** The fields every node shares, under an id unique to the test file. */
const base = (key: string) => ({
  id: `n${++nodeSeq}`,
  key,
  name: '',
  enabled: true,
  continueOnError: false,
  join: 'any' as const,
  ui: { x: 0, y: 0 },
});

export const action = (
  key: string,
  type: string,
  config: Record<string, unknown> = {},
): WorkflowNode =>
  ({ ...base(key), kind: 'action', action: type, config, credentialId: null }) as WorkflowNode;

export const delay = (key: string, minutes = 30): WorkflowNode =>
  ({ ...base(key), kind: 'delay', minutes }) as WorkflowNode;

/** The port a chain leaves a node by: its kind's default, the trigger's own for the trigger. */
const nextPort = (node: WorkflowNode | null): string =>
  node ? WORKFLOW_NODE_SPECS[node.kind].defaultPort : (WORKFLOW_TRIGGER_PORTS[0]?.name ?? 'out');

/** The trigger, then each node after the one before it. */
export function chain(...nodes: WorkflowNode[]): WorkflowGraph {
  let previous: WorkflowNode | null = null;
  const edges = nodes.map((node) => {
    const from = previous?.id ?? WORKFLOW_TRIGGER_ID;
    const link = {
      id: `e${++edgeSeq}`,
      from,
      fromPort: nextPort(previous),
      to: node.id,
      guard: null,
    };
    previous = node;
    return link;
  });
  return { nodes, edges };
}

export const onEvents = (events: ContentEvent[]): WorkflowTrigger => ({
  kind: 'event',
  events,
  typeIds: [],
  locales: [],
});

export const abortOn = (
  events: string[],
  match: Partial<WorkflowAbortTrigger['match']> = {},
): WorkflowAbortTrigger =>
  ({
    id: '',
    kind: 'event',
    events,
    typeIds: [],
    locales: [],
    filter: null,
    match: { mode: 'all', runKey: '', abortKey: '', ...match },
  }) as WorkflowAbortTrigger;
