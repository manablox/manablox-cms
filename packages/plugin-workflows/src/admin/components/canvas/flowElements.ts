import { MarkerType } from '@vue-flow/core';
import { toRaw } from 'vue';
import type {
  WorkflowActionMeta,
  WorkflowEdge,
  WorkflowNode,
  WorkflowPortSpec,
} from '../../../sdk';
import { CONTROL_NODES, nodeLabel, portsOf, type Tone, toneOf } from '../../model';

/** What a `GraphNode` card draws. */
export interface GraphNodeData {
  node: WorkflowNode;
  label: string;
  icon: string;
  tone: Tone;
  subtitle: string;
  ports: WorkflowPortSpec[];
  error: string | null;
  /** The status this node reached in the run being looked at, if any. */
  runStatus: string | null;
  unavailable: string | null;
}

/** Everything outside the node itself that its card depends on. */
export interface GraphNodeInputs {
  meta: WorkflowActionMeta | undefined;
  error: string | null;
  runStatus: string | null;
  /** The called workflow's name; call nodes only. */
  workflowName: string | undefined;
  readOnly: boolean;
}

export interface FlowNodeEntry {
  id: string;
  type: 'graph';
  position: { x: number; y: number };
  draggable: boolean;
  deletable: boolean;
  data: GraphNodeData;
}

/** A line under the node's name to tell two of the same action apart. */
function subtitleOf(node: WorkflowNode, inputs: GraphNodeInputs): string {
  if (node.kind === 'delay') return `${node.minutes} minutes`;
  if (node.kind === 'loop') {
    if (node.mode === 'count') return node.count ? `${node.count} times` : '';
    if (node.mode === 'until') {
      const count = node.until?.rules.length ?? 0;
      return count
        ? `Until ${count === 1 ? node.until.rules[0]?.field : `${count} rules hold`}`
        : '';
    }
    return node.items || 'The list the previous node produced';
  }
  if (node.kind === 'switch') {
    const cases = node.cases.length;
    return node.field ? `${node.field}, ${cases} case${cases === 1 ? '' : 's'}` : '';
  }
  if (node.kind === 'stop') {
    return node.message || (node.outcome === 'failed' ? 'Fails the run' : 'Ends the run');
  }
  if (node.kind === 'call') {
    if (!node.workflowId) return '';
    const name = inputs.workflowName ?? 'A workflow it cannot run';
    return node.wait ? name : `${name}, without waiting`;
  }
  if (node.kind === 'condition') {
    const first = node.rules[0];
    return first
      ? `${node.rules.length > 1 ? `${node.rules.length} rules, ` : ''}${first.field}`
      : 'No rules yet';
  }
  const config = node.config as Record<string, unknown>;
  for (const key of ['url', 'prompt', 'subject', 'title', 'typeId']) {
    const value = config[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return inputs.meta?.description ?? '';
}

function entryFor(node: WorkflowNode, inputs: GraphNodeInputs): FlowNodeEntry {
  const { meta } = inputs;
  const known = meta ? [meta] : [];
  const control = node.kind === 'action' ? null : CONTROL_NODES[node.kind];
  return {
    id: node.id,
    type: 'graph',
    position: { x: node.ui.x, y: node.ui.y },
    draggable: !inputs.readOnly,
    deletable: !inputs.readOnly,
    data: {
      node,
      label: nodeLabel(node, known),
      icon: control?.icon ?? meta?.icon ?? 'zap',
      tone: control?.tone ?? toneOf(meta?.tone),
      subtitle: subtitleOf(node, inputs),
      ports: portsOf(node, known),
      error: inputs.error,
      runStatus: inputs.runStatus,
      unavailable: meta && !meta.available ? meta.unavailable : null,
    },
  };
}

const sameInputs = (a: GraphNodeInputs, b: GraphNodeInputs) =>
  a.meta === b.meta &&
  a.error === b.error &&
  a.runStatus === b.runStatus &&
  a.workflowName === b.workflowName &&
  a.readOnly === b.readOnly;

/** Vue Flow entries per node object; an unchanged node and inputs return the same entry, so its card does not re-render. */
export function flowNodeCache() {
  const cache = new WeakMap<WorkflowNode, { inputs: GraphNodeInputs; entry: FlowNodeEntry }>();
  return (node: WorkflowNode, inputs: GraphNodeInputs): FlowNodeEntry => {
    const key = toRaw(node);
    const hit = cache.get(key);
    if (hit && sameInputs(hit.inputs, inputs)) return hit.entry;
    const entry = entryFor(node, inputs);
    cache.set(key, { inputs, entry });
    return entry;
  };
}

const EDGE_TONE: Record<string, string> = {
  error: 'var(--canvas-edge-error)',
  default: 'var(--canvas-edge-warn)',
  false: 'var(--canvas-edge-warn)',
  true: 'var(--canvas-edge-ok)',
};

function edgeEntryFor(edge: WorkflowEdge) {
  return {
    id: edge.id,
    source: edge.from,
    sourceHandle: edge.fromPort,
    target: edge.to,
    targetHandle: 'in',
    type: 'smoothstep',
    // Animated so the flow direction is visible.
    animated: true,
    label: edge.guard
      ? `if ${edge.guard.rules.length} rule${edge.guard.rules.length === 1 ? '' : 's'}`
      : '',
    markerEnd: MarkerType.ArrowClosed,
    style: { stroke: EDGE_TONE[edge.fromPort] ?? 'var(--canvas-edge)', strokeWidth: 2 },
  };
}

export type FlowEdgeEntry = ReturnType<typeof edgeEntryFor>;

/** Vue Flow entries per edge object, reused while the edge is unchanged. */
export function flowEdgeCache() {
  const cache = new WeakMap<WorkflowEdge, FlowEdgeEntry>();
  return (edge: WorkflowEdge): FlowEdgeEntry => {
    const key = toRaw(edge);
    let entry = cache.get(key);
    if (!entry) {
      entry = edgeEntryFor(edge);
      cache.set(key, entry);
    }
    return entry;
  };
}
