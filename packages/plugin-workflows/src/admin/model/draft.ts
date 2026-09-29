import {
  snapWorkflowPosition,
  type WorkflowAbortTrigger,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowTrigger,
} from '../../sdk';

/** A workflow as stored. A node's `key` names it in templates, so the editor keeps it unique. */
export interface Draft {
  name: string;
  description: string;
  enabled: boolean;
  trigger: WorkflowTrigger;
  abortTriggers: WorkflowAbortTrigger[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

/** What a stored workflow, version or run definition carries. */
export interface DraftSource {
  name: string;
  description?: string | null | undefined;
  trigger: WorkflowTrigger;
  abortTriggers?: WorkflowAbortTrigger[] | null | undefined;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

/** A stored graph in the shape the editor and canvas use, positions on the canvas grid. */
export function toDraft(source: DraftSource, enabled: boolean): Draft {
  return {
    name: source.name,
    description: source.description ?? '',
    enabled,
    trigger: source.trigger,
    abortTriggers: source.abortTriggers ?? [],
    nodes: source.nodes.map((node) => ({ ...node, ui: snapWorkflowPosition(node.ui) })),
    edges: source.edges,
  };
}

/** Workflow id -> name for the workflows call nodes can run. */
export function workflowNames(
  callable: readonly { id: string; name: string }[] | undefined,
): Record<string, string> {
  return Object.fromEntries((callable ?? []).map((entry) => [entry.id, entry.name]));
}

/** A workflow a model designed, laid out and ready to create. */
export interface WorkflowDesign {
  name: string;
  description: string | null;
  trigger: WorkflowTrigger;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  /** What the model says about it. */
  notes: string;
  /** What still fails validation. */
  problems: string[];
}
