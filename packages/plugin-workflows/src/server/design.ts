import { randomUUID } from 'node:crypto';
import { type ErrorDetail, ManabloxError } from '@manablox/core';
import {
  isWorkflowNodeKind,
  readWorkflowNode,
  WORKFLOW_LAYOUT,
  WORKFLOW_NODE_KINDS,
  WORKFLOW_NODE_SPECS,
  WORKFLOW_TRIGGER_ID,
  WORKFLOW_TRIGGER_PORTS,
  type WorkflowActionMeta,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowNodeIdRef,
  type WorkflowNodeKind,
  workflowNodeAction,
  workflowNodeIdRefs,
} from '../sdk.js';
import { keyValueRows } from './actions/shared.js';
import type { WorkflowDesignContext } from './design-prompt.js';
import { asRecord, readAbortTriggers, readTrigger, type TypeIdOf } from './design-triggers.js';
import {
  type ValidationEnvironment,
  validateWorkflow,
  type WorkflowInput,
} from './validate/index.js';

/**
 * Designs a workflow from a description. The model writes named steps (easier than ids
 * and edges); this builds the graph, resolves names to ids, lays it out and validates it,
 * reporting problems in terms of the model's steps.
 */

export interface WorkflowDesign {
  workflow: WorkflowInput;
  notes: string;
}

/** Builds the workflow from the answer and validates it; problems use the model's step keys. */
export function readWorkflowDesign(
  answer: Record<string, unknown>,
  context: WorkflowDesignContext,
  env: ValidationEnvironment,
): { value: WorkflowDesign; problems: string[] } {
  const problems: string[] = [];
  const typeId: TypeIdOf = (name) => {
    if (typeof name !== 'string') return null;
    const type = context.contentTypes.find((entry) => entry.name === name || entry.id === name);
    if (!type) problems.push(`There is no document type "${name}".`);
    return type?.id ?? null;
  };

  const trigger = readTrigger(asRecord(answer.trigger), context, typeId, problems);
  const abortTriggers = readAbortTriggers(answer.abortTriggers, context, typeId, problems);

  const steps = (Array.isArray(answer.steps) ? answer.steps : []).map(asRecord);
  if (!steps.length) problems.push('"steps" must hold at least one step.');

  const idOf = new Map<string, string>();
  for (const step of steps) {
    const key = typeof step.key === 'string' ? step.key : '';
    if (key && !idOf.has(key)) idOf.set(key, randomUUID());
  }

  const nodes = steps.map((step, index) => {
    const key = typeof step.key === 'string' ? step.key : `step_${index + 1}`;
    return readStep(step, key, idOf.get(key) ?? randomUUID(), context, typeId, problems);
  });
  const kindOf = new Map(nodes.map((node) => [node.id, node.kind]));

  const edges: WorkflowEdge[] = [];
  for (const [index, step] of steps.entries()) {
    const { id, key } = nodes[index] as WorkflowNode;
    const links = Array.isArray(step.after) ? step.after : [];
    // Only the first step defaults to the trigger; validation reports other orphans.
    const effective = links.length ? links : index === 0 ? [{ step: WORKFLOW_TRIGGER_ID }] : [];
    for (const link of effective) {
      const entry = typeof link === 'string' ? { step: link } : asRecord(link);
      const from = String(entry.step ?? '');
      const fromId = from === WORKFLOW_TRIGGER_ID ? WORKFLOW_TRIGGER_ID : idOf.get(from);
      if (!fromId) {
        problems.push(`Step "${key}" follows "${from}", which is not a step.`);
        continue;
      }
      edges.push({
        id: randomUUID(),
        from: fromId,
        fromPort:
          typeof entry.port === 'string' && entry.port
            ? entry.port
            : designPort(kindOf.get(fromId)),
        to: id,
        guard: null,
      });
    }
  }

  layout(nodes, edges);

  const workflow: WorkflowInput = {
    name:
      typeof answer.name === 'string' && answer.name.trim()
        ? answer.name.trim().slice(0, 200)
        : 'New workflow',
    description:
      typeof answer.description === 'string' ? answer.description.trim().slice(0, 1000) : null,
    enabled: false,
    trigger,
    abortTriggers,
    nodes,
    edges,
  };

  try {
    validateWorkflow(workflow, env, context.registry);
  } catch (error) {
    if (!ManabloxError.is(error)) throw error;
    for (const detail of error.details) problems.push(describeProblem(detail, nodes, edges));
  }

  return {
    value: {
      workflow,
      notes: typeof answer.notes === 'string' ? answer.notes.trim().slice(0, 1000) : '',
    },
    problems,
  };
}

/** A node from one of the model's steps, names of other records resolved to ids. */
function readStep(
  step: Record<string, unknown>,
  key: string,
  id: string,
  context: WorkflowDesignContext,
  typeId: TypeIdOf,
  problems: string[],
): WorkflowNode {
  let kind: WorkflowNodeKind = 'action';
  if (isWorkflowNodeKind(step.kind)) kind = step.kind;
  else if (step.kind !== undefined && step.kind !== null) {
    problems.push(
      `Step "${key}" has the kind "${String(step.kind)}"; use one of ${WORKFLOW_NODE_KINDS.join(', ')}.`,
    );
  }
  const node = readWorkflowNode(
    kind,
    {
      id,
      key,
      name: typeof step.name === 'string' ? step.name.slice(0, 200) : '',
      enabled: true,
      continueOnError: step.continueOnError === true,
      join: step.join === 'all' ? 'all' : 'any',
      ui: { x: 0, y: 0 },
    },
    step,
  ) as WorkflowNode;

  const type = workflowNodeAction(node);
  const action =
    type === null ? undefined : context.catalog.actions.find((entry) => entry.type === type);
  if (type !== null) {
    if (!action) {
      problems.push(
        `Step "${key}" uses the action "${String(step.action)}", which does not exist.`,
      );
    }
    Object.assign(node, {
      config: { ...(action?.defaults ?? {}), ...readConfig(asRecord(step.config), action, typeId) },
    });
  }

  // The model names other records; the node holds their ids.
  const fields = node as unknown as Record<string, unknown>;
  for (const ref of workflowNodeIdRefs(node)) {
    fields[ref.field] = resolveRef(ref, step[ref.kind] ?? ref.id, key, action, context, problems);
  }
  return node;
}

/** The id of the record a step names, by name, slug or id. */
function resolveRef(
  ref: WorkflowNodeIdRef,
  raw: unknown,
  key: string,
  action: WorkflowActionMeta | undefined,
  context: WorkflowDesignContext,
  problems: string[],
): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  if (ref.kind === 'workflow') {
    const target = (context.catalog.callable ?? []).find(
      (entry) => entry.name === raw || entry.id === raw,
    );
    if (!target) problems.push(`Step "${key}" runs the workflow "${raw}", which cannot be run.`);
    return target?.id ?? null;
  }
  const credential = context.catalog.credentials.find(
    (entry) => entry.name === raw || entry.slug === raw || entry.id === raw,
  );
  if (!credential) {
    problems.push(`Step "${key}" names the credential "${raw}", which does not exist.`);
    return null;
  }
  if (action?.credential && !action.credential.kinds.includes(credential.kind)) {
    problems.push(
      `Step "${key}" names the credential "${raw}", a ${credential.kind} credential; the action takes ${action.credential.kinds.join(' or ')}.`,
    );
    return null;
  }
  return credential.id;
}

/** The port a link without one leaves by. */
function designPort(kind: WorkflowNodeKind | undefined): string {
  return kind ? WORKFLOW_NODE_SPECS[kind].designPort : (WORKFLOW_TRIGGER_PORTS[0]?.name ?? 'out');
}

/** The step's config over the action's defaults, with type names resolved to ids. */
function readConfig(
  config: Record<string, unknown>,
  action: WorkflowActionMeta | undefined,
  typeId: (name: unknown) => string | null,
): Record<string, unknown> {
  const out = { ...config };
  if (action && 'typeId' in out && typeof out.typeId === 'string' && out.typeId) {
    out.typeId = typeId(out.typeId) ?? out.typeId;
  }
  // Normalize to the rows the editor's form expects.
  for (const field of action?.fields ?? []) {
    if (field.kind === 'keyValue' && field.name in out) {
      out[field.name] = keyValueRows(out[field.name]);
    }
  }
  return out;
}

/** Rows by depth from the trigger, lanes by arrival order; matches the editor's tidy layout. */
function layout(nodes: WorkflowNode[], edges: WorkflowEdge[]): void {
  const depth = new Map<string, number>([[WORKFLOW_TRIGGER_ID, 0]]);
  // Longest path, relaxed once per node; enough since cyclic graphs fail validation.
  for (let pass = 0; pass < nodes.length; pass++) {
    for (const edge of edges) {
      const from = depth.get(edge.from);
      if (from === undefined) continue;
      if ((depth.get(edge.to) ?? -1) < from + 1) depth.set(edge.to, from + 1);
    }
  }
  const lanes = new Map<number, number>();
  for (const node of nodes) {
    const row = depth.get(node.id) ?? nodes.length + 1;
    const lane = lanes.get(row) ?? 0;
    lanes.set(row, lane + 1);
    node.ui = { x: lane * WORKFLOW_LAYOUT.laneX, y: row * WORKFLOW_LAYOUT.y };
  }
}

/** A validation problem in the model's terms. */
function describeProblem(
  detail: ErrorDetail,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): string {
  const path = detail.path ?? [];
  const params = detail.params ? ` ${JSON.stringify(detail.params)}` : '';
  if (path[0] === 'nodes' && typeof path[1] === 'number') {
    const node = nodes[path[1]];
    const rest = path.slice(2).join('.');
    return `Step "${node?.key ?? path[1]}"${rest ? ` (${rest})` : ''}: ${detail.key}${params}`;
  }
  if (path[0] === 'edges' && typeof path[1] === 'number') {
    const edge = edges[path[1]];
    const key = (id: string | undefined) =>
      id === WORKFLOW_TRIGGER_ID ? 'trigger' : (nodes.find((node) => node.id === id)?.key ?? id);
    return `The link from "${key(edge?.from)}" (port "${edge?.fromPort}") to "${key(edge?.to)}": ${detail.key}${params}`;
  }
  return `${path.join('.') || 'workflow'}: ${detail.key}${params}`;
}
