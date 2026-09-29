import { slugify } from '@manablox/core';
import type {
  WorkflowActionStepInput,
  WorkflowCallStepInput,
  WorkflowLoopStepInput,
  WorkflowStepInput,
  WorkflowSwitchStepInput,
} from '../define/workflow.js';
import {
  WORKFLOW_NODE_SPECS,
  WORKFLOW_TRIGGER_ID,
  WORKFLOW_TRIGGER_PORTS,
  type WorkflowCallNode,
  type WorkflowEdge,
  type WorkflowLoopNode,
  type WorkflowNode,
  type WorkflowNodeKind,
  type WorkflowStepBranch,
  type WorkflowSwitchNode,
} from '../sdk.js';

/**
 * Inverse of `defineWorkflow`: a saved graph as steps. Condition, switch case and error
 * edges are written at the source (`then`, `else`, `onError`), others at the target (`after`,
 * `port`). Inexpressible edges are reported.
 */
export interface StepsFromGraph {
  steps: WorkflowStepInput[];
  /** Inexpressible edges, for the file header. */
  unexpressed: string[];
}

/** The port an edge leaves by when a step does not name one; empty when it must. */
function impliedPort(kind: WorkflowNodeKind | undefined): string {
  if (!kind) return WORKFLOW_TRIGGER_PORTS[0]?.name ?? 'out';
  const spec = WORKFLOW_NODE_SPECS[kind];
  return spec.portRequired ? '' : spec.defaultPort;
}

/** How a saved graph's ids and references are written as step fields. */
interface StepsFromGraphOptions {
  credentialSlug: (id: string) => string | null;
  workflowSlug: (id: string) => string | null;
  deref: <T>(value: T) => T;
}

export function stepsFromGraph(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  options: StepsFromGraphOptions,
): StepsFromGraph {
  const ordered = walkOrder(nodes, edges);
  const keys = stepKeys(ordered);
  const keyOf = (id: string) => (id === WORKFLOW_TRIGGER_ID ? WORKFLOW_TRIGGER_ID : keys.get(id));
  const graph: GraphKeys = {
    edges,
    ordered,
    keys,
    keyOf,
    kindOf: new Map(nodes.map((node) => [node.id, node.kind])),
    claims: sourceClaims(ordered, edges, keyOf),
  };

  const unexpressed: string[] = [];
  const steps = ordered.map((node, index) => {
    const key = keys.get(node.id) as string;
    const base: StepPlacement = {
      key,
      ...(node.name ? { name: node.name } : {}),
      ...stepWiring(graph, node, index, unexpressed),
      ...(node.join === 'all' ? { join: 'all' as const } : {}),
      ...(node.enabled ? {} : { enabled: false }),
    };
    return nodeStep(node, base, graph.claims, options, unexpressed);
  });
  return { steps, unexpressed };
}

/** The fields every step has: its key, name and where it is wired from. */
type StepPlacement = Pick<
  WorkflowActionStepInput,
  'key' | 'name' | 'after' | 'port' | 'join' | 'enabled'
>;

/** Edges written at their source: branch fields and switch cases. */
interface SourceClaims {
  /** Their targets are not chained to a neighbour. */
  claimed: Set<WorkflowEdge>;
  /** Node id -> branch field -> the step key it goes to. */
  branch: Map<string, Partial<Record<WorkflowStepBranch, string>>>;
  /** `<switch id>:<case id>` -> the step key that case goes to. */
  caseTargets: Map<string, string>;
  /** Step keys some branch or case goes to. */
  branched: Set<string>;
}

/** A graph's nodes in step order, with their keys and source-claimed edges. */
interface GraphKeys {
  edges: readonly WorkflowEdge[];
  ordered: readonly WorkflowNode[];
  keys: Map<string, string>;
  keyOf: (id: string) => string | undefined;
  kindOf: ReadonlyMap<string, WorkflowNodeKind>;
  claims: SourceClaims;
}

function sourceClaims(
  ordered: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  keyOf: (id: string) => string | undefined,
): SourceClaims {
  const claimed = new Set<WorkflowEdge>();
  const branch = new Map<string, Partial<Record<WorkflowStepBranch, string>>>();
  const caseTargets = new Map<string, string>();
  for (const node of ordered) {
    const out = edges.filter((edge) => edge.from === node.id);
    for (const [field, port] of Object.entries(WORKFLOW_NODE_SPECS[node.kind].branches)) {
      const edge = out.find((entry) => entry.fromPort === port);
      const target = edge && keyOf(edge.to);
      if (!edge || !target) continue;
      claimed.add(edge);
      branch.set(node.id, { ...branch.get(node.id), [field]: target });
    }
    if (node.kind !== 'switch') continue;
    for (const entry of node.cases) {
      const edge = out.find((candidate) => candidate.fromPort === entry.id);
      const target = edge && keyOf(edge.to);
      if (!edge || !target) continue;
      claimed.add(edge);
      caseTargets.set(`${node.id}:${entry.id}`, target);
    }
  }
  const branched = new Set([
    ...[...branch.values()].flatMap((entry) => Object.values(entry)),
    ...caseTargets.values(),
  ]);
  return { claimed, branch, caseTargets, branched };
}

/** A step's `after` and `port` from its unclaimed incoming edges; the rest is reported. */
function stepWiring(
  graph: GraphKeys,
  node: WorkflowNode,
  index: number,
  unexpressed: string[],
): Pick<StepPlacement, 'after' | 'port'> {
  const { keys, keyOf, claims } = graph;
  const key = keys.get(node.id) as string;
  const incoming = graph.edges.filter((edge) => edge.to === node.id && !claims.claimed.has(edge));
  const sources = incoming
    .map((edge) => ({ edge, key: keyOf(edge.from) }))
    .filter((entry): entry is { edge: WorkflowEdge; key: string } => Boolean(entry.key));

  // One `port` per step: keep the largest group, report the rest.
  const byPort = new Map<string, string[]>();
  for (const entry of sources) {
    byPort.set(entry.edge.fromPort, [...(byPort.get(entry.edge.fromPort) ?? []), entry.key]);
  }
  const groups = [...byPort.entries()].sort((a, b) => b[1].length - a[1].length);
  const [port, from] = groups[0] ?? [];
  for (const [extraPort, extras] of groups.slice(1)) {
    for (const extra of extras) {
      unexpressed.push(`the edge ${extra} (${extraPort}) -> ${key} needs wiring by hand`);
    }
  }

  const implied = (source: string) =>
    impliedPort(
      source === WORKFLOW_TRIGGER_ID
        ? undefined
        : (graph.kindOf.get(nodeIdOf(source, keys)) ?? 'action'),
    );
  const wanted = from ?? [];
  // `after` only when not following the previous step.
  const previous =
    index > 0 ? (keys.get(graph.ordered[index - 1]?.id as string) as string) : WORKFLOW_TRIGGER_ID;
  const isDefault =
    wanted.length === 1 &&
    wanted[0] === previous &&
    !claims.branched.has(key) &&
    port === implied(previous);
  const explicitPort = port && wanted.some((source) => implied(source) !== port) ? port : undefined;

  const after = isDefault
    ? undefined
    : wanted.length === 0
      ? claims.branched.has(key)
        ? undefined
        : null
      : wanted.length === 1
        ? (wanted[0] as string)
        : wanted;
  return {
    ...(after === undefined ? {} : { after }),
    ...(explicitPort ? { port: explicitPort } : {}),
  };
}

/** A node as a step of its kind; lost references are reported. */
function nodeStep(
  node: WorkflowNode,
  base: StepPlacement,
  claims: SourceClaims,
  options: StepsFromGraphOptions,
  unexpressed: string[],
): WorkflowStepInput {
  const branches = claims.branch.get(node.id) ?? {};
  switch (node.kind) {
    case 'action': {
      const credential = node.credentialId ? options.credentialSlug(node.credentialId) : null;
      if (node.credentialId && !credential) {
        unexpressed.push(`step ${base.key} uses a credential this space no longer has`);
      }
      return {
        ...base,
        action: node.action,
        ...(Object.keys(node.config).length ? { config: options.deref(node.config) } : {}),
        ...(credential ? { credential } : {}),
        ...branches,
        ...(node.continueOnError ? { continueOnError: true } : {}),
      };
    }
    case 'condition':
      return {
        ...base,
        condition: {
          ...(node.match === 'any' ? { match: 'any' as const } : {}),
          rules: options.deref(node.rules),
        },
        ...branches,
      };
    case 'call': {
      const workflow = node.workflowId ? options.workflowSlug(node.workflowId) : null;
      if (!workflow) unexpressed.push(`step ${base.key} runs a workflow this space no longer has`);
      return {
        ...base,
        call: callOf(node, workflow),
        ...branches,
        ...(node.continueOnError ? { continueOnError: true } : {}),
      };
    }
    case 'switch':
      return {
        ...base,
        switch: switchOf(node, claims.caseTargets, options.deref),
        ...branches,
      };
    case 'loop':
      return { ...base, loop: loopOf(node, options.deref), ...branches };
    case 'stop':
      return {
        ...base,
        stop: {
          ...(node.outcome === 'failed' ? { outcome: 'failed' as const } : {}),
          ...(node.message ? { message: node.message } : {}),
        },
      };
    default:
      return { ...base, delayMinutes: node.minutes };
  }
}

function callOf(node: WorkflowCallNode, workflow: string | null): WorkflowCallStepInput['call'] {
  return {
    workflow: workflow ?? '',
    ...(node.input.length
      ? { input: Object.fromEntries(node.input.map((row) => [row.name, row.value])) }
      : {}),
    ...(node.wait ? {} : { wait: false }),
  };
}

function switchOf(
  node: WorkflowSwitchNode,
  caseTargets: ReadonlyMap<string, string>,
  deref: StepsFromGraphOptions['deref'],
): WorkflowSwitchStepInput['switch'] {
  return {
    field: node.field,
    cases: node.cases.map((entry) => {
      const then = caseTargets.get(`${node.id}:${entry.id}`);
      return {
        id: entry.id,
        ...(entry.label ? { label: entry.label } : {}),
        ...(entry.operator === 'equals' ? {} : { operator: entry.operator }),
        ...(entry.value ? { value: deref(entry.value) } : {}),
        ...(then ? { then } : {}),
      };
    }),
  };
}

function loopOf(
  node: WorkflowLoopNode,
  deref: StepsFromGraphOptions['deref'],
): WorkflowLoopStepInput['loop'] {
  const mode = node.mode ?? 'items';
  return {
    ...(mode === 'items' && node.items ? { items: node.items } : {}),
    ...(mode === 'count' ? { times: node.count } : {}),
    ...(mode === 'until'
      ? {
          until: {
            ...(node.until.match === 'any' ? { match: 'any' as const } : {}),
            rules: deref(node.until.rules),
          },
        }
      : {}),
    maxItems: node.maxItems,
  };
}

/** The node a step key belongs to, for reading a source node's kind back. */
function nodeIdOf(key: string, keys: Map<string, string>): string {
  for (const [id, candidate] of keys) if (candidate === key) return id;
  return key;
}

/** Breadth-first from the trigger; unreached nodes follow in saved order. */
function walkOrder(nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[]): WorkflowNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  }

  const ordered: WorkflowNode[] = [];
  const seen = new Set<string>([WORKFLOW_TRIGGER_ID]);
  const queue = [WORKFLOW_TRIGGER_ID];
  while (queue.length) {
    const current = queue.shift() as string;
    for (const next of outgoing.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      const node = byId.get(next);
      if (node) ordered.push(node);
      queue.push(next);
    }
  }
  for (const node of nodes) if (!seen.has(node.id)) ordered.push(node);
  return ordered;
}

/** The saved key when valid, otherwise one from the name. */
function stepKeys(nodes: readonly WorkflowNode[]): Map<string, string> {
  const keys = new Map<string, string>();
  const taken = new Set<string>([WORKFLOW_TRIGGER_ID]);
  nodes.forEach((node, index) => {
    const base =
      usable(node.key) || usable(slugify(node.name).replace(/-/g, '_')) || `step_${index + 1}`;
    let candidate = base;
    for (let suffix = 2; taken.has(candidate); suffix++) candidate = `${base}_${suffix}`;
    taken.add(candidate);
    keys.set(node.id, candidate);
  });
  return keys;
}

/** The step-key shape `defineWorkflow` insists on: `[a-z][a-z0-9_]{0,39}`. */
function usable(value: string | undefined): string | null {
  return value && /^[a-z][a-z0-9_]{0,39}$/.test(value) ? value : null;
}
