import { randomUUID } from 'node:crypto';
import {
  findCycle,
  loopBody,
  reachableNodes,
  upstreamNodes,
  WORKFLOW_NODE_SPECS,
  WORKFLOW_TRIGGER_ID,
  WORKFLOW_TRIGGER_PORTS,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
  workflowNodeAction,
  workflowNodePorts,
  workflowNodeTemplateFields,
} from '../../sdk.js';
import type { WorkflowRegistry } from '../registry.js';
import { placeholders } from '../template.js';
import { type Add, nodeKeyOf, validateRules } from './shared.js';

export function validateEdges(
  edges: WorkflowEdge[],
  nodes: WorkflowNode[],
  registry: WorkflowRegistry,
  add: Add,
): WorkflowEdge[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const out: WorkflowEdge[] = [];

  for (const [index, edge] of edges.entries()) {
    const at = (...rest: (string | number)[]) => ['edges', index, ...rest];
    const from = edge.from === WORKFLOW_TRIGGER_ID ? WORKFLOW_TRIGGER_ID : edge.from;

    if (from !== WORKFLOW_TRIGGER_ID && !byId.has(from)) {
      add('plugins.workflows.edge.nodeUnknown', at('from'), { id: from });
      continue;
    }
    if (!byId.has(edge.to)) {
      add('plugins.workflows.edge.nodeUnknown', at('to'), { id: edge.to });
      continue;
    }
    if (from === edge.to) {
      add('plugins.workflows.edge.selfLoop', at('to'));
      continue;
    }

    const ports = portsOf(from === WORKFLOW_TRIGGER_ID ? null : byId.get(from), registry);
    if (!ports.includes(edge.fromPort)) {
      add('plugins.workflows.edge.portUnknown', at('fromPort'), { port: edge.fromPort });
      continue;
    }

    const signature = `${from}:${edge.fromPort}->${edge.to}`;
    if (seen.has(signature)) {
      add('plugins.workflows.edge.duplicate', at());
      continue;
    }
    seen.add(signature);

    out.push({
      id: edge.id || randomUUID(),
      from,
      fromPort: edge.fromPort,
      to: edge.to,
      guard: edge.guard ? validateRules(edge.guard, (...rest) => at('guard', ...rest), add) : null,
    });
  }
  return out;
}

/** The ports a node offers; the trigger's when there is no node. */
export function portsOf(
  node: WorkflowNode | null | undefined,
  registry: WorkflowRegistry,
): string[] {
  if (!node) return WORKFLOW_TRIGGER_PORTS.map((port) => port.name);
  const type = workflowNodeAction(node);
  // Unknown actions are reported on their node; their edges get the standard ports.
  const action = type ? registry.actions.tryGet(type) : null;
  return workflowNodePorts(node, action).map((port) => port.name);
}

export function validateShape(graph: WorkflowGraph, add: Add): void {
  if (graph.nodes.length === 0) return;

  const cycle = findCycle(graph);
  if (cycle) {
    const keys = cycle.map((id) => graph.nodes.find((node) => node.id === id)?.key ?? id);
    add('plugins.workflows.graph.cycle', ['edges'], { nodes: keys });
    // Reachability is meaningless on a cyclic graph.
    return;
  }

  const reachable = reachableNodes(graph);
  if (reachable.size === 0) {
    add('plugins.workflows.graph.startRequired', ['edges']);
    return;
  }
  for (const [index, node] of graph.nodes.entries()) {
    if (!reachable.has(node.id)) {
      add('plugins.workflows.node.unreachable', ['nodes', index], { key: node.key });
    }
  }
  validateLoops(graph, add);
}

/** Nothing outside a loop may lead into its branch, and a branch may not contain a wait. */
function validateLoops(graph: WorkflowGraph, add: Add): void {
  for (const loop of graph.nodes) {
    if (loop.kind !== 'loop') continue;
    const body = loopBody(graph, loop.id);
    for (const [index, edge] of graph.edges.entries()) {
      if (!body.has(edge.to) || body.has(edge.from)) continue;
      if (edge.from === loop.id && edge.fromPort === 'each') continue;
      add('plugins.workflows.loop.enteredFromOutside', ['edges', index], { loop: loop.key });
    }
    for (const [index, node] of graph.nodes.entries()) {
      if (WORKFLOW_NODE_SPECS[node.kind].pauses && body.has(node.id)) {
        add('plugins.workflows.loop.waitInside', ['nodes', index], { loop: loop.key });
      }
    }
  }
}

/** `{{ nodes.x.… }}` may only name a node that runs before this one. */
export function validateReferences(graph: WorkflowGraph, add: Add): void {
  const keys = new Map(graph.nodes.map((node) => [node.key, node.id]));
  // `{{ item }}` and `{{ loop.index }}` only have a value inside a loop's branch.
  const looped = new Set(
    graph.nodes
      .filter((node) => node.kind === 'loop')
      .flatMap((loop) => [...loopBody(graph, loop.id)]),
  );

  for (const [index, node] of graph.nodes.entries()) {
    const upstream = upstreamNodes(graph, node.id);
    // A loop's `until` rules run after each pass, so they read its branch too.
    const body = node.kind === 'loop' ? loopBody(graph, node.id) : null;
    for (const { path, at } of referencesOf(node, index)) {
      const afterPass = body !== null && at[2] === 'until';
      if (isLoopPath(path)) {
        if (!looped.has(node.id) && !afterPass) {
          add('plugins.workflows.reference.outsideLoop', at, { path });
        }
        continue;
      }
      const key = nodeKeyOf(path);
      if (!key) continue;
      const target = keys.get(key);
      if (!target) add('plugins.workflows.reference.unknownNode', at, { key });
      else if (!upstream.has(target) && !(afterPass && body.has(target))) {
        add('plugins.workflows.reference.notUpstream', at, { key });
      }
    }
  }
}

/** Every `nodes.<key>` and loop placeholder in a node's templates, with its path. */
function referencesOf(
  node: WorkflowNode,
  index: number,
): Array<{ path: string; at: (string | number)[] }> {
  const found: Array<{ path: string; at: (string | number)[] }> = [];
  const scan = (value: unknown, at: (string | number)[]): void => {
    if (typeof value === 'string') {
      for (const placeholder of placeholders(value)) {
        if (nodeKeyOf(placeholder) || isLoopPath(placeholder)) {
          found.push({ path: placeholder, at });
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const [i, entry] of value.entries()) scan(entry, [...at, i]);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) scan(entry, [...at, key]);
    }
  };
  for (const field of workflowNodeTemplateFields(node)) {
    scan(field.value, ['nodes', index, ...field.at]);
  }
  return found;
}

const isLoopPath = (path: string): boolean =>
  path === 'item' || path.startsWith('item.') || path === 'loop' || path.startsWith('loop.');
