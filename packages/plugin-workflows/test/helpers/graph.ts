import type { ContentEvent } from '@manablox/core';
import {
  WORKFLOW_NODE_SPECS,
  WORKFLOW_TRIGGER_ID,
  WORKFLOW_TRIGGER_PORTS,
  type WorkflowAbortTrigger,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowTrigger,
} from '../../src/sdk.js';

let nodeSeq = 0;
let edgeSeq = 0;

/** The fields every node shares, under an id unique to the test file. */
export const base = (key: string) => ({
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
  extra: Partial<WorkflowNode> = {},
): WorkflowNode =>
  ({
    ...base(key),
    kind: 'action',
    action: type,
    config,
    credentialId: null,
    ...extra,
  }) as WorkflowNode;

export const delay = (key: string, minutes = 30): WorkflowNode =>
  ({ ...base(key), kind: 'delay', minutes }) as WorkflowNode;

export const condition = (
  key: string,
  rules: Array<Record<string, unknown>>,
  extra: Partial<WorkflowNode> = {},
): WorkflowNode =>
  ({ ...base(key), kind: 'condition', match: 'all', rules, ...extra }) as WorkflowNode;

export const call = (
  key: string,
  workflowId: string,
  input: Record<string, string> = {},
  wait = true,
): WorkflowNode =>
  ({
    ...base(key),
    kind: 'call',
    workflowId,
    input: Object.entries(input).map(([name, value]) => ({ name, value })),
    wait,
  }) as WorkflowNode;

/** A `transform.json` action rendering `template`. */
export const shape = (key: string, template: string): WorkflowNode =>
  action(key, 'transform.json', { template });

export const edge = (from: string, to: string, port = 'ok'): WorkflowEdge => ({
  id: `e${++edgeSeq}`,
  from,
  fromPort: port,
  to,
  guard: null,
});

/** The port a chain leaves a node by: its kind's default, the trigger's own for the trigger. */
const nextPort = (node: WorkflowNode | null): string =>
  node ? WORKFLOW_NODE_SPECS[node.kind].defaultPort : (WORKFLOW_TRIGGER_PORTS[0]?.name ?? 'out');

/** The trigger, then each node after the one before it. */
export function chain(...nodes: WorkflowNode[]): WorkflowGraph {
  let previous: WorkflowNode | null = null;
  const edges = nodes.map((node) => {
    const link = edge(previous?.id ?? WORKFLOW_TRIGGER_ID, node.id, nextPort(previous));
    previous = node;
    return link;
  });
  return { nodes, edges };
}

export const onEvents = (events: ContentEvent[], typeIds: string[] = []): WorkflowTrigger => ({
  kind: 'event',
  events,
  typeIds,
  locales: [],
});

export const onCreated: WorkflowTrigger = onEvents(['content.created']);

/** A trigger for a workflow other workflows call. */
export const called = (
  parameters: Array<{ name: string; required?: boolean }> = [],
  output = '',
): WorkflowTrigger => ({
  kind: 'call',
  parameters: parameters.map((entry) => ({
    name: entry.name,
    description: '',
    required: entry.required ?? false,
  })),
  output,
});

export const abortOn = (
  events: string[],
  match: Partial<WorkflowAbortTrigger['match']> = {},
  extra: Partial<WorkflowAbortTrigger> = {},
): WorkflowAbortTrigger =>
  ({
    id: '',
    kind: 'event',
    events,
    typeIds: [],
    locales: [],
    filter: null,
    match: { mode: 'all', runKey: '', abortKey: '', ...match },
    ...extra,
  }) as WorkflowAbortTrigger;
