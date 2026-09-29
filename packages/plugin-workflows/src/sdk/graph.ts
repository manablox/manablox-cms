/** Graph walks: edges, reachability, upstream nodes, loop bodies and cycles. */

import { WORKFLOW_TRIGGER_ID, type WorkflowEdge, type WorkflowGraph } from './workflow.js';

export const workflowEdgesFrom = (graph: WorkflowGraph, nodeId: string): WorkflowEdge[] =>
  graph.edges.filter((edge) => edge.from === nodeId);

export const workflowEdgesTo = (graph: WorkflowGraph, nodeId: string): WorkflowEdge[] =>
  graph.edges.filter((edge) => edge.to === nodeId);

/** Node ids reachable from the trigger, following edges forwards. */
export function reachableNodes(graph: WorkflowGraph): Set<string> {
  const seen = new Set<string>();
  const queue = [WORKFLOW_TRIGGER_ID];
  while (queue.length) {
    const current = queue.shift() as string;
    for (const edge of graph.edges) {
      if (edge.from !== current || seen.has(edge.to)) continue;
      seen.add(edge.to);
      queue.push(edge.to);
    }
  }
  return seen;
}

/** Node ids that can reach `nodeId`, i.e. whose outputs exist there. */
export function upstreamNodes(graph: WorkflowGraph, nodeId: string): Set<string> {
  const seen = new Set<string>();
  const queue = [nodeId];
  while (queue.length) {
    const current = queue.shift() as string;
    for (const edge of graph.edges) {
      if (edge.to !== current || seen.has(edge.from)) continue;
      seen.add(edge.from);
      queue.push(edge.from);
    }
  }
  seen.delete(nodeId);
  return seen;
}

/** Nodes reachable from a loop's `each` port. */
export function loopBody(graph: WorkflowGraph, loopId: string): Set<string> {
  const body = new Set<string>();
  const queue = graph.edges
    .filter((edge) => edge.from === loopId && edge.fromPort === 'each')
    .map((edge) => edge.to);
  while (queue.length) {
    const current = queue.shift() as string;
    if (body.has(current) || current === loopId) continue;
    body.add(current);
    for (const edge of graph.edges) if (edge.from === current) queue.push(edge.to);
  }
  return body;
}

/** The first cycle found, as the node ids on it, or null when the graph is a DAG. */
export function findCycle(graph: WorkflowGraph): string[] | null {
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  }
  const state = new Map<string, 'open' | 'closed'>();
  const path: string[] = [];

  const walk = (id: string): string[] | null => {
    const seen = state.get(id);
    if (seen === 'closed') return null;
    if (seen === 'open') return [...path.slice(path.indexOf(id)), id];
    state.set(id, 'open');
    path.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const cycle = walk(next);
      if (cycle) return cycle;
    }
    path.pop();
    state.set(id, 'closed');
    return null;
  };

  for (const node of [WORKFLOW_TRIGGER_ID, ...graph.nodes.map((node) => node.id)]) {
    const cycle = walk(node);
    if (cycle) return cycle;
  }
  return null;
}
