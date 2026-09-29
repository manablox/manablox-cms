/**
 * Code-declared workflows: keyed steps compiled to a `WorkflowGraph`. A step follows the
 * previous one unless it names `after` or is another step's branch target.
 */

import {
  type ContentEvent,
  humanise,
  isMachineName,
  ManabloxError,
  ref,
  type SpaceTarget,
} from '@manablox/core';
import { stableId } from '@manablox/core/node';
import type {
  WorkflowAbortEvent,
  WorkflowAbortMatch,
  WorkflowAbortTrigger,
  WorkflowAbortTriggerKinds,
} from '../sdk/abort.js';
import {
  readWorkflowNode,
  WORKFLOW_NODE_SPECS,
  type WorkflowStepBranch,
} from '../sdk/node-spec.js';
import {
  WORKFLOW_DEFAULT_LOOP_ITEMS,
  WORKFLOW_GRID,
  WORKFLOW_TRIGGER_ID,
  WORKFLOW_TRIGGER_PORTS,
  type WorkflowCallNode,
  type WorkflowCallParameter,
  type WorkflowConditionNode,
  type WorkflowConditionOperator,
  type WorkflowConditionRule,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowLoopNode,
  type WorkflowNode,
  type WorkflowNodeKind,
  type WorkflowRuleSet,
  type WorkflowSelection,
  type WorkflowStopNode,
  type WorkflowSwitchNode,
  type WorkflowTrigger,
  type WorkflowTriggerKinds,
} from '../sdk/workflow.js';

/** The resource kind code workflows are declared under, `resources.plugins[...]`. */
export const WORKFLOW_RESOURCE_KIND = 'workflows.workflow';

/** The step key a template addresses a node by: `{{ nodes.<key>.… }}`. */
const STEP_KEY = /^[a-z][a-z0-9_]{0,39}$/;

/** Where a step's incoming edges come from. `null` means none - for a branch target. */
export type StepSource = string | readonly string[] | null;

interface StepBase {
  key: string;
  /** The node's label; the action's own stands in when it is left out. */
  name?: string | undefined;
  /** Defaults to the step declared before this one, or the trigger for the first. */
  after?: StepSource | undefined;
  /** Which port of `after` this leaves by. Defaults by the kind of node `after` is. */
  port?: string | undefined;
  /** How this waits when several edges arrive. See `WorkflowNodeBase.join`. */
  join?: 'any' | 'all' | undefined;
  enabled?: boolean | undefined;
}

export interface WorkflowActionStepInput extends StepBase {
  /** A key in the action registry: `email`, `http`, or one a plugin contributes. */
  action: string;
  config?: Record<string, unknown> | undefined;
  /** A credential slug of the same space; resolved to an id when the row is written. */
  credential?: string | undefined;
  /** A step key the `error` port goes to. Without one a failure ends the run. */
  onError?: string | undefined;
  continueOnError?: boolean | undefined;
}

export interface WorkflowConditionStepInput extends StepBase {
  condition: { match?: 'all' | 'any' | undefined; rules: WorkflowConditionRule[] };
  /** Step keys the `true` and `false` ports go to. */
  then?: string | undefined;
  else?: string | undefined;
}

export interface WorkflowDelayStepInput extends StepBase {
  delayMinutes: number;
}

export interface WorkflowSwitchCaseInput {
  /** The port the case leaves by; `case_<n>` by its place when left out. */
  id?: string | undefined;
  label?: string | undefined;
  /** Defaults to `equals`. */
  operator?: WorkflowConditionOperator | undefined;
  value?: string | undefined;
  /** The step key this case goes to. */
  then?: string | undefined;
}

export interface WorkflowSwitchStepInput extends StepBase {
  /** `field` is a path into the run; the first case that holds for it is taken. */
  switch: { field: string; cases: WorkflowSwitchCaseInput[] };
  /** The step key the `default` port goes to, when no case holds. */
  else?: string | undefined;
}

export interface WorkflowLoopStepInput extends StepBase {
  /**
   * What to go through; see `WorkflowLoopNode`. `times` repeats a number of times, `until`
   * repeats until its rules hold, otherwise it goes through `items` (empty takes the
   * previous step's list).
   */
  loop: {
    items?: string | undefined;
    times?: string | number | undefined;
    until?: { match?: 'all' | 'any' | undefined; rules: WorkflowConditionRule[] } | undefined;
    maxItems?: number | undefined;
  };
  /** The step key the `each` port goes to: the first step of what runs per pass. */
  each?: string | undefined;
}

export interface WorkflowStopStepInput extends StepBase {
  /** Ends the whole run; `succeeded` by default. */
  stop: { outcome?: 'succeeded' | 'failed' | undefined; message?: string | undefined };
}

export interface WorkflowCallStepInput extends StepBase {
  call: {
    /** The slug of a code workflow with a `call` trigger. */
    workflow: string;
    /** Parameter name -> a template. */
    input?: Record<string, string> | undefined;
    /** Defaults to true: wait for the run and hand on its output. */
    wait?: boolean | undefined;
  };
  /** A step key the `error` port goes to. Without one a failure ends the run. */
  onError?: string | undefined;
  continueOnError?: boolean | undefined;
}

export type WorkflowStepInput =
  | WorkflowActionStepInput
  | WorkflowConditionStepInput
  | WorkflowSwitchStepInput
  | WorkflowDelayStepInput
  | WorkflowLoopStepInput
  | WorkflowCallStepInput
  | WorkflowStopStepInput;

/** The node kind a step compiles to, by the field that marks it. */
function stepKind(step: WorkflowStepInput): WorkflowNodeKind {
  if ('action' in step) return 'action';
  if ('condition' in step) return 'condition';
  if ('switch' in step) return 'switch';
  if ('loop' in step) return 'loop';
  if ('call' in step) return 'call';
  if ('stop' in step) return 'stop';
  return 'delay';
}

/** The step keys a step's branch fields name, with the port each leaves by. */
function branchesOf(step: WorkflowStepInput): Array<{ target: string; port: string }> {
  const fields = step as Partial<Record<WorkflowStepBranch, string>>;
  const branches = Object.entries(WORKFLOW_NODE_SPECS[stepKind(step)].branches).flatMap(
    ([field, port]) => {
      const target = fields[field as WorkflowStepBranch];
      return target ? [{ target, port }] : [];
    },
  );
  if (!('switch' in step)) return branches;
  const cases = switchCases(step);
  const own = step.switch.cases.flatMap((entry, index) => {
    const port = cases[index]?.id;
    return entry.then && port ? [{ target: entry.then, port }] : [];
  });
  return [...own, ...branches];
}

/** A switch step's cases as the node keeps them, ids filled in. */
function switchCases(step: WorkflowSwitchStepInput): WorkflowSwitchNode['cases'] {
  return (
    readWorkflowNode(
      'switch',
      {
        id: '',
        key: '',
        name: '',
        enabled: true,
        continueOnError: false,
        join: 'any',
        ui: { x: 0, y: 0 },
      },
      {
        field: step.switch.field,
        cases: step.switch.cases.map((entry, index) => ({
          id: entry.id ?? `case_${index + 1}`,
          label: entry.label ?? '',
          operator: entry.operator ?? 'equals',
          value: entry.value ?? '',
        })),
      },
    ) as WorkflowSwitchNode
  ).cases;
}

/** A scheduled run's document selection, with every part optional. */
export type CodeWorkflowSelection = Partial<WorkflowSelection>;

/** A trigger parameter; a bare name is an optional one. */
export type CodeWorkflowParameter = string | (Partial<WorkflowCallParameter> & { name: string });

/** A trigger of a kind another plugin contributes, as stored; its own helpers build one. */
export type ContributedWorkflowTrigger = WorkflowTriggerKinds[Exclude<
  keyof WorkflowTriggerKinds,
  'event' | 'schedule' | 'call' | 'manual'
>];

/** A `WorkflowTrigger` with optional defaults; a contributed kind as its plugin builds it. */
export type CodeWorkflowTrigger =
  | {
      kind: 'event';
      events: ContentEvent[];
      /** Content type ids; use `ref.contentType('article')`. Empty means every type. */
      typeIds?: string[] | undefined;
      locales?: string[] | undefined;
    }
  | {
      kind: 'schedule';
      cron: string;
      timezone?: string | undefined;
      selection?: CodeWorkflowSelection | null | undefined;
      perDocument?: boolean | undefined;
    }
  | {
      kind: 'call';
      /** What callers hand over; a bare name is an optional parameter. */
      parameters?: CodeWorkflowParameter[] | undefined;
      /** What callers get back; see `WorkflowCallTrigger.output`. */
      output?: string | undefined;
    }
  | {
      kind: 'manual';
      /** What whoever starts it hands over; a bare name is an optional parameter. */
      parameters?: CodeWorkflowParameter[] | undefined;
    }
  | ContributedWorkflowTrigger;

/** Which active runs an abort stops; `all` when omitted. */
export type CodeWorkflowAbortMatch = 'all' | 'document' | { key: { run: string; abort: string } };

/** What every code abort trigger may set besides its kind's own fields. */
interface CodeAbortOptions {
  filter?: WorkflowRuleSet | null | undefined;
  match?: CodeWorkflowAbortMatch | undefined;
}

/** An abort trigger of a kind another plugin contributes, without id, filter and match. */
export type ContributedCodeAbortTrigger = {
  [K in Exclude<keyof WorkflowAbortTriggerKinds, 'event'>]: Omit<
    WorkflowAbortTriggerKinds[K],
    'id' | 'filter' | 'match'
  > &
    CodeAbortOptions;
}[Exclude<keyof WorkflowAbortTriggerKinds, 'event'>];

/** What stops a code workflow's active runs. */
export type CodeWorkflowAbortTrigger =
  | ({
      kind: 'event';
      events: WorkflowAbortEvent[];
      typeIds?: string[] | undefined;
      locales?: string[] | undefined;
    } & CodeAbortOptions)
  | ContributedCodeAbortTrigger;

export interface WorkflowDefinitionInput {
  slug: string;
  name?: string | undefined;
  description?: string | undefined;
  spaces?: SpaceTarget | undefined;
  /** Whether the row is written switched on. Only read when the row is created. */
  enabled?: boolean | undefined;
  trigger: CodeWorkflowTrigger;
  /** Events or calls that abort the workflow's active runs. */
  abortOn?: CodeWorkflowAbortTrigger[] | undefined;
  steps: WorkflowStepInput[];
}

/**
 * A workflow as the reconciler receives it: a graph, with references still unresolved. An
 * entry of the `workflows.workflow` resource kind.
 */
export interface WorkflowDefinition {
  kind: 'workflow';
  slug: string;
  name: string;
  description: string | null;
  spaces: SpaceTarget;
  enabled: boolean;
  trigger: WorkflowTrigger;
  abortTriggers: WorkflowAbortTrigger[];
  graph: WorkflowGraph;
  /** Set by `resolveConfig` to the plugin that declared it, or `config`. */
  sourceRef?: string;
}

/** Canvas spacing, on the canvas grid. */
const COLUMN = 16 * WORKFLOW_GRID;
const LANE = 9 * WORKFLOW_GRID;

export function defineWorkflow(input: WorkflowDefinitionInput): WorkflowDefinition {
  if (!isMachineName(input.slug)) {
    throw ManabloxError.badRequest('codeResource.slug.invalid', {
      kind: WORKFLOW_RESOURCE_KIND,
      slug: input.slug,
    });
  }
  if (input.steps.length === 0) {
    throw ManabloxError.badRequest('plugins.workflows.code.steps.required', { slug: input.slug });
  }

  const byKey = new Map<string, WorkflowStepInput>();
  for (const step of input.steps) {
    if (!STEP_KEY.test(step.key)) {
      throw ManabloxError.badRequest('plugins.workflows.code.step.keyInvalid', {
        slug: input.slug,
        key: step.key,
      });
    }
    if (byKey.has(step.key)) {
      throw ManabloxError.badRequest('plugins.workflows.code.step.keyDuplicate', {
        slug: input.slug,
        key: step.key,
      });
    }
    byKey.set(step.key, step);
  }

  const nodeId = (key: string) => stableId(`workflow:${input.slug}`, key);
  const require = (key: string, from: string) => {
    if (key !== WORKFLOW_TRIGGER_ID && !byKey.has(key)) {
      throw ManabloxError.badRequest('plugins.workflows.code.step.targetUnknown', {
        slug: input.slug,
        key: from,
        target: key,
      });
    }
    return key;
  };

  // Branch targets are not chained to their neighbour, or they would bypass the branch.
  const branched = new Set<string>();
  for (const step of input.steps) {
    for (const { target } of branchesOf(step)) branched.add(require(target, step.key));
  }

  const nodes = input.steps.map((step, index) => buildNode(step, index, nodeId));
  const kindOf = new Map(nodes.map((node) => [node.id, node.kind]));

  const edges: WorkflowEdge[] = [];
  const seen = new Set<string>();
  const addEdge = (fromKey: string, port: string | undefined, toKey: string, owner: string) => {
    const from = fromKey === WORKFLOW_TRIGGER_ID ? WORKFLOW_TRIGGER_ID : nodeId(fromKey);
    const to = nodeId(toKey);
    const fromPort = port ?? defaultPort(input.slug, owner, from, kindOf);
    const signature = `${from}:${fromPort}:${to}`;
    if (seen.has(signature)) return;
    seen.add(signature);
    edges.push({
      id: stableId(`workflowEdge:${input.slug}`, signature),
      from,
      fromPort,
      to,
      guard: null,
    });
  };

  input.steps.forEach((step, index) => {
    for (const source of sourcesOf(step, index, input.steps, branched)) {
      addEdge(require(source, step.key), step.port, step.key, step.key);
    }
    for (const { target, port } of branchesOf(step)) addEdge(step.key, port, target, step.key);
  });

  layout(nodes, edges);

  return {
    kind: 'workflow',
    slug: input.slug,
    name: input.name ?? humanise(input.slug),
    description: input.description ?? null,
    spaces: input.spaces ?? '*',
    enabled: input.enabled ?? false,
    trigger: normaliseTrigger(input.trigger),
    abortTriggers: (input.abortOn ?? []).map((trigger, index) =>
      normaliseAbortTrigger(trigger, stableId(`workflowAbort:${input.slug}`, String(index))),
    ),
    graph: { nodes, edges },
  };
}

/** Where a step's incoming edges start, once the defaults are applied. */
function sourcesOf(
  step: WorkflowStepInput,
  index: number,
  steps: WorkflowStepInput[],
  branched: Set<string>,
): string[] {
  if (step.after === null) return [];
  if (step.after !== undefined) {
    return typeof step.after === 'string' ? [step.after] : [...step.after];
  }
  if (branched.has(step.key)) return [];
  const previous = steps[index - 1];
  return [previous ? previous.key : WORKFLOW_TRIGGER_ID];
}

/** The implicit port of `from`; some kinds have none and need a branch field or a port. */
function defaultPort(
  slug: string,
  key: string,
  from: string,
  kindOf: Map<string, WorkflowNode['kind']>,
): string {
  const kind = from === WORKFLOW_TRIGGER_ID ? undefined : kindOf.get(from);
  if (!kind) return WORKFLOW_TRIGGER_PORTS[0]?.name ?? 'out';
  const spec = WORKFLOW_NODE_SPECS[kind];
  if (spec.portRequired) {
    throw ManabloxError.badRequest('plugins.workflows.code.step.portRequired', { slug, key });
  }
  return spec.defaultPort;
}

function buildNode(
  step: WorkflowStepInput,
  index: number,
  nodeId: (key: string) => string,
): WorkflowNode {
  const base = {
    id: nodeId(step.key),
    key: step.key,
    name: step.name ?? '',
    enabled: step.enabled ?? true,
    continueOnError: false,
    join: step.join ?? ('any' as const),
    ui: { x: COLUMN * (index + 1), y: 0 },
  };

  const kind = stepKind(step);
  if (kind === 'action') {
    const action = step as WorkflowActionStepInput;
    return {
      ...base,
      kind: 'action',
      action: action.action,
      config: action.config ?? {},
      continueOnError: action.continueOnError ?? false,
      credentialId: action.credential ? ref.credential(action.credential) : null,
    };
  }
  if (kind === 'condition') {
    const { condition } = step as WorkflowConditionStepInput;
    return {
      ...base,
      kind: 'condition',
      match: condition.match ?? 'all',
      rules: condition.rules,
    } satisfies WorkflowConditionNode;
  }
  if (kind === 'call') {
    const call = step as WorkflowCallStepInput;
    return {
      ...base,
      kind: 'call',
      workflowId: ref.of(WORKFLOW_RESOURCE_KIND, call.call.workflow),
      input: Object.entries(call.call.input ?? {}).map(([name, value]) => ({ name, value })),
      wait: call.call.wait ?? true,
      continueOnError: call.continueOnError ?? false,
    } satisfies WorkflowCallNode;
  }
  if (kind === 'switch') {
    const input = step as WorkflowSwitchStepInput;
    return {
      ...base,
      kind: 'switch',
      field: input.switch.field,
      cases: switchCases(input),
    } satisfies WorkflowSwitchNode;
  }
  if (kind === 'loop') {
    const { loop } = step as WorkflowLoopStepInput;
    return {
      ...base,
      kind: 'loop',
      mode: loop.until ? 'until' : loop.times !== undefined ? 'count' : 'items',
      items: loop.items ?? '',
      count: loop.times === undefined ? '' : String(loop.times),
      until: { match: loop.until?.match ?? 'all', rules: loop.until?.rules ?? [] },
      maxItems: loop.maxItems ?? WORKFLOW_DEFAULT_LOOP_ITEMS,
    } satisfies WorkflowLoopNode;
  }
  if (kind === 'stop') {
    const { stop } = step as WorkflowStopStepInput;
    return {
      ...base,
      kind: 'stop',
      outcome: stop.outcome ?? 'succeeded',
      message: stop.message ?? '',
    } satisfies WorkflowStopNode;
  }
  return { ...base, kind: 'delay', minutes: (step as WorkflowDelayStepInput).delayMinutes };
}

/** BFS depth becomes the column; unreachable nodes get a column of their own. */
function layout(nodes: WorkflowNode[], edges: WorkflowEdge[]): void {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  }

  const depth = new Map<string, number>([[WORKFLOW_TRIGGER_ID, 0]]);
  const queue = [WORKFLOW_TRIGGER_ID];
  while (queue.length) {
    const current = queue.shift() as string;
    const next = (depth.get(current) ?? 0) + 1;
    for (const to of outgoing.get(current) ?? []) {
      if (depth.has(to)) continue;
      depth.set(to, next);
      queue.push(to);
    }
  }

  const stray = Math.max(0, ...[...depth.values()]) + 1;
  const lanes = new Map<number, number>();
  for (const node of nodes) {
    const column = depth.get(node.id) ?? stray;
    const lane = lanes.get(column) ?? 0;
    lanes.set(column, lane + 1);
    node.ui = { x: COLUMN * column, y: LANE * lane };
  }
}

function normaliseParameters(
  parameters: CodeWorkflowParameter[] | undefined,
): WorkflowCallParameter[] {
  return (parameters ?? []).map((parameter) =>
    typeof parameter === 'string'
      ? { name: parameter, description: '', required: false }
      : {
          name: parameter.name,
          description: parameter.description ?? '',
          required: parameter.required ?? false,
        },
  );
}

function normaliseTrigger(trigger: CodeWorkflowTrigger): WorkflowTrigger {
  if (trigger.kind === 'event') {
    return {
      kind: 'event',
      events: trigger.events,
      typeIds: trigger.typeIds ?? [],
      locales: trigger.locales ?? [],
    };
  }
  if (trigger.kind === 'schedule') {
    const selection = trigger.selection;
    return {
      kind: 'schedule',
      cron: trigger.cron,
      timezone: trigger.timezone ?? 'UTC',
      selection: selection
        ? {
            typeIds: selection.typeIds ?? [],
            status: selection.status ?? 'any',
            changedWithinHours: selection.changedWithinHours ?? null,
            locale: selection.locale ?? null,
          }
        : null,
      perDocument: trigger.perDocument ?? false,
    };
  }
  if (trigger.kind === 'call') {
    return {
      kind: 'call',
      parameters: normaliseParameters(trigger.parameters),
      output: trigger.output ?? '',
    };
  }
  if (trigger.kind === 'manual') {
    return { kind: 'manual', parameters: normaliseParameters(trigger.parameters) };
  }
  // A contributed kind comes as its plugin built it.
  return trigger;
}

function normaliseAbortTrigger(
  trigger: CodeWorkflowAbortTrigger,
  id: string,
): WorkflowAbortTrigger {
  const wanted = trigger.match ?? 'all';
  const match: WorkflowAbortMatch =
    typeof wanted === 'string'
      ? { mode: wanted, runKey: '', abortKey: '' }
      : { mode: 'key', runKey: wanted.key.run, abortKey: wanted.key.abort };
  const filter = trigger.filter ?? null;
  if (trigger.kind !== 'event') {
    return { ...trigger, id, filter, match } as unknown as WorkflowAbortTrigger;
  }
  return {
    id,
    kind: 'event',
    events: trigger.events,
    typeIds: trigger.typeIds ?? [],
    locales: trigger.locales ?? [],
    filter,
    match,
  };
}
