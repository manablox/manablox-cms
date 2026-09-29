import { type ErrorDetail, ManabloxError } from '@manablox/core';
import type {
  WorkflowAbortTrigger,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
  WorkflowTrigger,
} from '../../sdk.js';
import type { WorkflowRegistry } from '../registry.js';
import { validateAbortTriggers } from './abort.js';
import { validateEdges, validateReferences, validateShape } from './graph.js';
import { validateNodes } from './nodes.js';
import type { Add, ValidationEnvironment } from './shared.js';
import { validateOutput, validateTrigger } from './trigger.js';

export { MAX_ABORT_TRIGGERS } from './abort.js';
export { portsOf } from './graph.js';
export type { ValidationEnvironment } from './shared.js';
export { MAX_CALL_PARAMETERS } from './trigger.js';

/** An untrusted workflow as the editor submits it. */
export interface WorkflowInput {
  name: string;
  description?: string | null | undefined;
  enabled?: boolean | undefined;
  trigger: WorkflowTrigger;
  abortTriggers?: WorkflowAbortTrigger[] | undefined;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface ValidatedWorkflow {
  name: string;
  description: string | null;
  enabled: boolean;
  trigger: WorkflowTrigger;
  abortTriggers: WorkflowAbortTrigger[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

/** Semantic workflow checks; reports every problem at once, each with its field path. */
export function validateWorkflow(
  input: WorkflowInput,
  env: ValidationEnvironment,
  registry: WorkflowRegistry,
): ValidatedWorkflow {
  const problems: ErrorDetail[] = [];
  const add: Add = (key, path, params) =>
    problems.push({ key, path, ...(params ? { params } : {}) });

  const name = input.name.trim();
  if (!name) add('plugins.workflows.name.required', ['name']);

  const trigger = validateTrigger(input.trigger, env, registry, add);
  const nodes = validateNodes(
    input.nodes ?? [],
    { ...env, emptyCallTargets: env.emptyCallTargets === true && input.enabled !== true },
    registry,
    add,
  );
  if (nodes.length === 0) add('plugins.workflows.nodes.required', ['nodes']);
  const edges = validateEdges(input.edges ?? [], nodes, registry, add);
  const abortTriggers = validateAbortTriggers(input.abortTriggers ?? [], nodes, env, registry, add);

  const graph: WorkflowGraph = { nodes, edges };
  validateShape(graph, add);
  validateReferences(graph, add);
  if (trigger.kind === 'call') validateOutput(trigger.output, nodes, add);

  if (problems.length)
    throw ManabloxError.validation(problems, 'plugins.workflows.validation.failed');

  return {
    name,
    description: input.description?.trim() || null,
    enabled: input.enabled ?? false,
    trigger,
    abortTriggers,
    nodes,
    edges,
  };
}
