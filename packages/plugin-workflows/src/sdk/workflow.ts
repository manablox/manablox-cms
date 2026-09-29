/**
 * Workflow triggers and graphs. Nodes are walked from the trigger; each publishes its
 * result under its `key`, read later as `{{ nodes.fetch_order.body.id }}`.
 */

import type { ContentEvent } from '@manablox/core';
import type { WorkflowAbortTrigger } from './abort.js';

/** Starts when content changes. Empty `typeIds` / `locales` mean every type / locale. */
export interface WorkflowEventTrigger {
  kind: 'event';
  events: ContentEvent[];
  typeIds: string[];
  locales: string[];
}

/** Which documents a scheduled run looks at, when it looks at any. */
export interface WorkflowSelection {
  /** Empty means every type. */
  typeIds: string[];
  status: 'any' | 'draft' | 'published';
  /** Only documents changed in the last N hours; `null` means all of them. */
  changedWithinHours: number | null;
  /** Only this locale; `null` means all of them. */
  locale: string | null;
}

/** Five-field `cron` in `timezone`. `perDocument` runs once per selected document. */
export interface WorkflowScheduleTrigger {
  kind: 'schedule';
  cron: string;
  timezone: string;
  selection: WorkflowSelection | null;
  perDocument: boolean;
}

/** A value a caller, or whoever starts it by hand, hands over; read as `{{ input.<name> }}`. */
export interface WorkflowCallParameter {
  name: string;
  description: string;
  /** A call that leaves it out fails. */
  required: boolean;
}

/** Starts when another workflow's call node runs it. */
export interface WorkflowCallTrigger {
  kind: 'call';
  parameters: WorkflowCallParameter[];
  /**
   * What the caller gets back, rendered when the run ends; a lone placeholder keeps its type.
   * Empty hands back every node's output by key.
   */
  output: string;
}

/** Starts only when someone starts it by hand, with the values it asks for. */
export interface WorkflowManualTrigger {
  kind: 'manual';
  parameters: WorkflowCallParameter[];
}

/**
 * Trigger kinds by name. A plugin that contributes a kind to the `triggers` extension point
 * adds its shape here:
 *
 * ```ts
 * declare module '@manablox/plugin-workflows/define' {
 *   interface WorkflowTriggerKinds { webhook: WebhookTrigger }
 * }
 * ```
 *
 * Augment an entry the file imports (the main entry, `/define` or `/sdk`), like
 * `WorkflowFieldKinds`.
 *
 * Stored workflows may hold kinds of plugins that are not configured; those never start.
 */
export interface WorkflowTriggerKinds {
  event: WorkflowEventTrigger;
  schedule: WorkflowScheduleTrigger;
  call: WorkflowCallTrigger;
  manual: WorkflowManualTrigger;
}

export type WorkflowTrigger = WorkflowTriggerKinds[keyof WorkflowTriggerKinds];

/** The built-in trigger kinds. */
export const WORKFLOW_BUILTIN_TRIGGER_KINDS = ['event', 'schedule', 'call', 'manual'] as const;

/** How many calls deep a run may be. */
export const WORKFLOW_MAX_CALL_DEPTH = 5;

// --- what flows between nodes --------------------------------------------------------

/** What a port carries. Editor hints only; the engine does not enforce them. */
export const WORKFLOW_DATA_TYPES = [
  'any',
  'none',
  'text',
  'html',
  'json',
  'number',
  'boolean',
  'document',
  'documents',
  'asset',
  'assets',
  'httpResponse',
  'pages',
] as const;
export type WorkflowDataType = (typeof WORKFLOW_DATA_TYPES)[number];

export const WORKFLOW_DATA_TYPE_LABELS: Record<WorkflowDataType, string> = {
  any: 'Anything',
  none: 'Nothing',
  text: 'Text',
  html: 'HTML',
  json: 'JSON',
  number: 'Number',
  boolean: 'Yes / no',
  document: 'Document',
  documents: 'Documents',
  asset: 'Asset',
  assets: 'Assets',
  httpResponse: 'API response',
  pages: 'Crawled pages',
};

/** One connection point of a node, and what travels through it. */
export interface WorkflowPortSpec {
  name: string;
  label: string;
  type: WorkflowDataType;
  description?: string;
}

/** A data picker path, relative to the node: `body.items[0].id`. */
export interface WorkflowOutputPath {
  path: string;
  type: WorkflowDataType;
  hint: string;
}

/** What a node produced, as later nodes and the run log see it. */
export interface WorkflowNodeOutput {
  type: WorkflowDataType;
  value: unknown;
}

// --- the graph -----------------------------------------------------------------------

export const WORKFLOW_NODE_KINDS = [
  'action',
  'condition',
  'switch',
  'delay',
  'loop',
  'call',
  'stop',
] as const;
export type WorkflowNodeKind = (typeof WORKFLOW_NODE_KINDS)[number];

/** The id of the implicit start node; edges leave the trigger from here. */
export const WORKFLOW_TRIGGER_ID = 'trigger';

/** The canvas snap grid in px. */
export const WORKFLOW_GRID = 16;

/** Canvas layout steps, shared with the editor; multiples of `WORKFLOW_GRID`. */
export const WORKFLOW_LAYOUT = { x: 352, y: 176, laneX: 352 } as const;

/** A canvas position on the grid; anything not finite becomes 0. */
export const snapWorkflowPosition = (at: { x: number; y: number }): { x: number; y: number } => {
  const snap = (value: number) =>
    Number.isFinite(value) ? Math.round(value / WORKFLOW_GRID) * WORKFLOW_GRID || 0 : 0;
  return { x: snap(at.x), y: snap(at.y) };
};

export interface WorkflowNodeBase {
  /** Stable across saves, so run logs and edges survive a rename. */
  id: string;
  /** Unique slug templates address the node by: `{{ nodes.<key>.… }}`. */
  key: string;
  /** Optional; the action's label stands in when empty. */
  name: string;
  enabled: boolean;
  /** A failure is logged and the run carries on down the `ok` edges. */
  continueOnError: boolean;
  /** `any` runs when one incoming edge fires; `all` waits for every incoming edge to settle. */
  join: 'any' | 'all';
  /** Where the node sits on the canvas. */
  ui: { x: number; y: number };
}

export interface WorkflowActionNode extends WorkflowNodeBase {
  kind: 'action';
  /** A key in the action registry: `email`, `http`, `ai.generate`, `crawl.site`. */
  action: string;
  /** The shape belongs to the action definition; the registry validates it. */
  config: Record<string, unknown>;
  /** A credential from the space's vault, when the action asks for one. */
  credentialId: string | null;
}

export interface WorkflowConditionRule {
  /** A path into the run context: `content.status`, `nodes.fetch.body.total`. */
  field: string;
  operator: WorkflowConditionOperator;
  /** Ignored by the unary operators. */
  value: string;
}

export interface WorkflowRuleSet {
  match: 'all' | 'any';
  rules: WorkflowConditionRule[];
}

/** A fork: the rules decide whether the run leaves by `true` or by `false`. */
export interface WorkflowConditionNode extends WorkflowNodeBase, WorkflowRuleSet {
  kind: 'condition';
}

export interface WorkflowDelayNode extends WorkflowNodeBase {
  kind: 'delay';
  minutes: number;
}

/** One way out of a switch: the switch's value compared by `operator` with `value`. */
export interface WorkflowSwitchCase {
  /** The port the case leaves by; stable across renames. */
  id: string;
  /** Optional; the comparison stands in when empty. */
  label: string;
  operator: WorkflowConditionOperator;
  /** Ignored by the unary operators. */
  value: string;
}

/** Leaves by the first case that holds for `field`, or by `default` when none does. */
export interface WorkflowSwitchNode extends WorkflowNodeBase {
  kind: 'switch';
  /** A path into the run context, as a rule's `field`. */
  field: string;
  cases: WorkflowSwitchCase[];
}

/** The port a switch leaves by when no case holds. */
export const WORKFLOW_SWITCH_DEFAULT_PORT = 'default';
/** The most cases one switch may have. */
export const WORKFLOW_MAX_SWITCH_CASES = 10;

/** How a loop decides its passes: a list's items, a count, or until rules hold. */
export const WORKFLOW_LOOP_MODES = ['items', 'count', 'until'] as const;
export type WorkflowLoopMode = (typeof WORKFLOW_LOOP_MODES)[number];

/**
 * Runs the `each` branch per pass (`{{ item }}`, `{{ loop.index }}`), then continues by
 * `done` with every pass's output in `{{ nodes.<key>.results }}`.
 */
export interface WorkflowLoopNode extends WorkflowNodeBase {
  kind: 'loop';
  mode: WorkflowLoopMode;
  /** `items`: a placeholder for the list. Empty takes the previous node's output, or its first list. */
  items: string;
  /** `count`: how many passes; a number or a placeholder for one. */
  count: string;
  /** `until`: checked after each pass, with that pass's outputs; the loop ends once they hold. */
  until: WorkflowRuleSet;
  /** Items past it fail the node; passes past it end an `until` loop. */
  maxItems: number;
}

/** The most items one loop node may be set to take, and what a new one takes. */
export const WORKFLOW_MAX_LOOP_ITEMS = 500;
export const WORKFLOW_DEFAULT_LOOP_ITEMS = 50;

/**
 * Runs another workflow of the space with a `call` trigger. Waiting, it leaves by `ok` with
 * `{ runId, status, output }` once that run ends, or by `error` when it fails.
 */
export interface WorkflowCallNode extends WorkflowNodeBase {
  kind: 'call';
  workflowId: string | null;
  /** Parameter name -> a template; a lone placeholder or JSON keeps its type. */
  input: Array<{ name: string; value: string }>;
  /** Otherwise the called run is only started, and this node leaves by `ok` at once. */
  wait: boolean;
}

/** Ends the whole run here, as done or as failed. */
export interface WorkflowStopNode extends WorkflowNodeBase {
  kind: 'stop';
  outcome: 'succeeded' | 'failed';
  /** For the run log, and the failure's message; placeholders allowed. */
  message: string;
}

export type WorkflowNode =
  | WorkflowActionNode
  | WorkflowConditionNode
  | WorkflowSwitchNode
  | WorkflowDelayNode
  | WorkflowLoopNode
  | WorkflowCallNode
  | WorkflowStopNode;

/** `from` is a node id or `trigger`. A `guard` makes the edge conditional. */
export interface WorkflowEdge {
  id: string;
  from: string;
  fromPort: string;
  to: string;
  guard: WorkflowRuleSet | null;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

/** What publishing freezes into a version, and what a test run takes of the draft. */
export interface WorkflowSnapshot extends WorkflowGraph {
  name: string;
  description: string | null;
  trigger: WorkflowTrigger;
  abortTriggers: WorkflowAbortTrigger[];
}

/** The trigger's single outgoing port. */
export const WORKFLOW_TRIGGER_PORTS: WorkflowPortSpec[] = [
  { name: 'out', label: 'Starts', type: 'any' },
];

// --- conditions ----------------------------------------------------------------------

export const WORKFLOW_CONDITION_OPERATORS = [
  'equals',
  'notEquals',
  'contains',
  'notContains',
  'startsWith',
  'isEmpty',
  'isNotEmpty',
  'greaterThan',
  'lessThan',
  'changed',
] as const;
export type WorkflowConditionOperator = (typeof WORKFLOW_CONDITION_OPERATORS)[number];

export const WORKFLOW_CONDITION_OPERATOR_LABELS: Record<WorkflowConditionOperator, string> = {
  equals: 'is',
  notEquals: 'is not',
  contains: 'contains',
  notContains: 'does not contain',
  startsWith: 'starts with',
  isEmpty: 'is empty',
  isNotEmpty: 'is not empty',
  greaterThan: 'is greater than',
  lessThan: 'is less than',
  changed: 'changed in this save',
};

/** The unary operators, which the editor draws without a value field. */
export const WORKFLOW_UNARY_OPERATORS: readonly WorkflowConditionOperator[] = [
  'isEmpty',
  'isNotEmpty',
  'changed',
];
