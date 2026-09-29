/**
 * One spec per node kind and per trigger kind; the walker, validation, the AI designer,
 * import, code steps and the admin read these instead of branching on the kind.
 */

import { CONTENT_EVENTS } from '@manablox/core';
import { WORKFLOW_ABORT_EVENTS } from './abort.js';
import { actionPorts, type WorkflowActionMeta } from './action.js';
import {
  snapWorkflowPosition,
  WORKFLOW_CONDITION_OPERATOR_LABELS,
  WORKFLOW_CONDITION_OPERATORS,
  WORKFLOW_DEFAULT_LOOP_ITEMS,
  WORKFLOW_LOOP_MODES,
  WORKFLOW_MAX_LOOP_ITEMS,
  WORKFLOW_MAX_SWITCH_CASES,
  WORKFLOW_NODE_KINDS,
  WORKFLOW_SWITCH_DEFAULT_PORT,
  WORKFLOW_UNARY_OPERATORS,
  type WorkflowConditionOperator,
  type WorkflowLoopMode,
  type WorkflowNode,
  type WorkflowNodeBase,
  type WorkflowNodeKind,
  type WorkflowPortSpec,
  type WorkflowRuleSet,
  type WorkflowSwitchCase,
  type WorkflowTriggerKinds,
} from './workflow.js';

const WORKFLOW_CONDITION_PORTS: WorkflowPortSpec[] = [
  { name: 'true', label: 'Rules hold', type: 'none' },
  { name: 'false', label: 'Rules do not hold', type: 'none' },
];
const WORKFLOW_DELAY_PORTS: WorkflowPortSpec[] = [
  { name: 'out', label: 'After the wait', type: 'none' },
];
const WORKFLOW_CALL_PORTS: WorkflowPortSpec[] = [
  { name: 'ok', label: 'Finished', type: 'json' },
  { name: 'error', label: 'Failed', type: 'json' },
];
const WORKFLOW_LOOP_EACH_LABELS: Record<WorkflowLoopMode, string> = {
  items: 'For each item',
  count: 'Each time',
  until: 'Each time',
};
/** Every action has these two; a definition may declare more. */
const WORKFLOW_ACTION_PORTS: WorkflowPortSpec[] = [
  { name: 'ok', label: 'Succeeded', type: 'any' },
  { name: 'error', label: 'Failed', type: 'json' },
];

export type WorkflowNodeOf<K extends WorkflowNodeKind> = Extract<WorkflowNode, { kind: K }>;

/** A node's own fields, without the shared base and the kind. */
export type WorkflowNodeFields<K extends WorkflowNodeKind> = Omit<
  WorkflowNodeOf<K>,
  keyof WorkflowNodeBase | 'kind'
>;

/** The longest a delay node may wait. */
export const WORKFLOW_MAX_DELAY_MINUTES = 60 * 24 * 30;

/** A part of a node that may hold placeholders, with its path from the node. */
export interface WorkflowTemplateField {
  at: (string | number)[];
  value: unknown;
}

/** An id on a node that points at another record of the space. */
export interface WorkflowNodeIdRef {
  kind: 'credential' | 'workflow';
  field: 'credentialId' | 'workflowId';
  id: string | null;
}

/** Reports a problem at a path from the node. */
export type WorkflowNodeReport = (
  key: string,
  at: (string | number)[],
  params?: Record<string, unknown>,
) => void;

/** The code-step fields that wire an edge at its source, and the port each leaves by. */
export type WorkflowStepBranch = 'then' | 'else' | 'onError' | 'each';

export interface WorkflowNodeSpec<K extends WorkflowNodeKind = WorkflowNodeKind> {
  /** Stands in for an empty name; an action node shows its action's label instead. */
  label: string;
  description: string;
  /** Every port; an action's own need its metadata. */
  ports: (
    node: WorkflowNodeOf<K>,
    action?: Pick<WorkflowActionMeta, 'output' | 'ports'> | null,
  ) => WorkflowPortSpec[];
  /**
   * Left by when switched off or when `continueOnError` swallows a failure, and by a code
   * step that follows without naming a port. A loop's is `done`: after the last item.
   */
  defaultPort: string;
  /** Taken by an AI-designed link without a port. A loop's is `each`: the designer has no body field. */
  designPort: string;
  /** A code step that follows must name its port. */
  portRequired: boolean;
  branches: Partial<Record<WorkflowStepBranch, string>>;
  /** Saves the run to resume later, so it cannot sit inside a loop. */
  pauses: boolean;
  /** Placeholder-bearing parts, for reference checks. */
  templateFields: (node: WorkflowNodeOf<K>) => WorkflowTemplateField[];
  /** Ids of other records, remapped on import and resolved by name in the designer. */
  idRefs: (node: WorkflowNodeOf<K>) => WorkflowNodeIdRef[];
  /** Checks the kind's own fields as submitted. */
  check: (node: WorkflowNodeOf<K>, report: WorkflowNodeReport) => void;
  /** The kind's own fields from loose JSON, defaulted and trimmed. */
  read: (raw: Record<string, unknown>) => WorkflowNodeFields<K>;
  /** For the AI designer: the kind's JSON fields and what it does. */
  design: { fields: string; hint: string };
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const inRange = (value: number, min: number, max: number): boolean =>
  Number.isFinite(value) && value >= min && value <= max;

/** Checks a rule set as submitted: at least one rule, each with a field and a known operator. */
export function checkRuleSet(set: Partial<WorkflowRuleSet>, report: WorkflowNodeReport): void {
  const rules = Array.isArray(set.rules) ? set.rules : [];
  if (rules.length === 0) report('plugins.workflows.node.condition.rulesRequired', ['rules']);
  for (const [i, rule] of rules.entries()) {
    if (!str(rule?.field).trim()) {
      report('plugins.workflows.node.condition.fieldRequired', ['rules', i, 'field']);
    }
    if (!(WORKFLOW_CONDITION_OPERATORS as readonly unknown[]).includes(rule?.operator)) {
      report('plugins.workflows.rule.operatorUnknown', ['rules', i, 'operator'], {
        operator: rule?.operator,
      });
    }
  }
}

/** A rule set from loose JSON; an unknown operator becomes `equals`. */
export function readRuleSet(raw: Record<string, unknown>): WorkflowRuleSet {
  return {
    match: raw.match === 'any' ? 'any' : 'all',
    rules: (Array.isArray(raw.rules) ? raw.rules : []).map((entry) => {
      const rule = record(entry);
      return {
        field: String(rule.field ?? '').trim(),
        operator: (WORKFLOW_CONDITION_OPERATORS as readonly unknown[]).includes(rule.operator)
          ? (rule.operator as WorkflowConditionOperator)
          : 'equals',
        value: rule.value === undefined || rule.value === null ? '' : String(rule.value),
      };
    }),
  };
}

/** What a switch case goes by: its label, or its comparison. */
export function switchCaseLabel(
  entry: Pick<WorkflowSwitchCase, 'label' | 'operator' | 'value'>,
): string {
  if (entry.label.trim()) return entry.label.trim();
  const operator = WORKFLOW_CONDITION_OPERATOR_LABELS[entry.operator] ?? entry.operator;
  return WORKFLOW_UNARY_OPERATORS.includes(entry.operator)
    ? operator
    : `${operator} ${entry.value}`.trim();
}

/** The port shape a switch case id must have. */
const CASE_ID = /^[a-z][a-z0-9_]{0,39}$/;

/** Switch cases from loose JSON; a missing or clashing id becomes the next free `case_<n>`. */
function readCases(raw: unknown): WorkflowSwitchCase[] {
  const taken = new Set<string>();
  const rows = (Array.isArray(raw) ? raw : []).map(record);
  const wanted = rows.map((row) => str(row.id).trim());
  for (const id of wanted) if (CASE_ID.test(id)) taken.add(id);
  const seen = new Set<string>();
  let next = 1;
  return rows.map((row, index) => {
    let id = wanted[index] as string;
    if (!CASE_ID.test(id) || id === WORKFLOW_SWITCH_DEFAULT_PORT || seen.has(id)) {
      while (taken.has(`case_${next}`)) next++;
      id = `case_${next}`;
      taken.add(id);
    }
    seen.add(id);
    return {
      id,
      label: str(row.label).trim(),
      operator: (WORKFLOW_CONDITION_OPERATORS as readonly unknown[]).includes(row.operator)
        ? (row.operator as WorkflowConditionOperator)
        : 'equals',
      value: row.value === undefined || row.value === null ? '' : String(row.value),
    };
  });
}

/** Call input rows from a list of rows or a name-to-template map; unnamed rows are dropped. */
function inputRows(raw: unknown): Array<{ name: string; value: string }> {
  const rows = Array.isArray(raw)
    ? raw.map(record).map((row) => ({ name: str(row.name), value: row.value }))
    : Object.entries(record(raw)).map(([name, value]) => ({ name, value }));
  return rows
    .map((row) => ({
      name: row.name.trim(),
      value:
        typeof row.value === 'string'
          ? row.value
          : row.value === undefined || row.value === null
            ? ''
            : JSON.stringify(row.value),
    }))
    .filter((row) => row.name);
}

const noRefs = (): WorkflowNodeIdRef[] => [];
const noCheck = (): void => undefined;

export const WORKFLOW_NODE_SPECS: { [K in WorkflowNodeKind]: WorkflowNodeSpec<K> } = {
  action: {
    label: 'Action',
    description: 'Runs an installed action: a mail, a request, an AI prompt, a content change.',
    ports: (_node, action) => (action ? actionPorts(action) : WORKFLOW_ACTION_PORTS),
    defaultPort: 'ok',
    designPort: 'ok',
    portRequired: false,
    branches: { onError: 'error' },
    pauses: false,
    templateFields: (node) => [{ at: ['config'], value: node.config }],
    idRefs: (node) => [{ kind: 'credential', field: 'credentialId', id: node.credentialId }],
    check: noCheck,
    read: (raw) => ({
      action: str(raw.action),
      config: record(raw.config),
      credentialId: str(raw.credentialId) || null,
    }),
    design: {
      fields:
        '"action": "<action type>", "config": {<the action\'s fields>}, "credential": "<credential name or null>"',
      hint: 'runs an action; leaves by "ok" when it succeeded and by "error" when it failed.',
    },
  },
  condition: {
    label: 'Only continue if...',
    description: 'A fork: the rules decide whether the run goes on by yes or by no.',
    ports: () => WORKFLOW_CONDITION_PORTS,
    defaultPort: 'true',
    designPort: 'true',
    portRequired: true,
    branches: { then: 'true', else: 'false' },
    pauses: false,
    templateFields: (node) =>
      node.rules.flatMap((rule, i) => [
        { at: ['rules', i, 'field'], value: rule.field },
        { at: ['rules', i, 'value'], value: rule.value },
      ]),
    idRefs: noRefs,
    check: (node, report) => checkRuleSet(node, report),
    read: (raw) => readRuleSet(raw),
    design: {
      fields: `"match": "all" | "any", "rules": [{"field": "<path into the run, e.g. content.fields.category>", "operator": "<one of ${WORKFLOW_CONDITION_OPERATORS.join(', ')}>", "value": "<text; placeholders allowed>"}]`,
      hint: 'a fork that continues by port "true" when the rules hold and by port "false" otherwise.',
    },
  },
  switch: {
    label: 'Switch',
    description: 'Picks one way on by comparing a value with each case in turn.',
    ports: (node) => [
      ...node.cases.map((entry) => ({
        name: entry.id,
        label: switchCaseLabel(entry),
        type: 'none' as const,
      })),
      { name: WORKFLOW_SWITCH_DEFAULT_PORT, label: 'Otherwise', type: 'none' },
    ],
    defaultPort: WORKFLOW_SWITCH_DEFAULT_PORT,
    designPort: WORKFLOW_SWITCH_DEFAULT_PORT,
    portRequired: true,
    branches: { else: WORKFLOW_SWITCH_DEFAULT_PORT },
    pauses: false,
    templateFields: (node) => [
      { at: ['field'], value: node.field },
      ...node.cases.map((entry, i) => ({ at: ['cases', i, 'value'], value: entry.value })),
    ],
    idRefs: noRefs,
    check: (node, report) => {
      if (!str(node.field).trim()) report('plugins.workflows.node.switch.fieldRequired', ['field']);
      const cases = Array.isArray(node.cases) ? node.cases : [];
      if (cases.length === 0) report('plugins.workflows.node.switch.casesRequired', ['cases']);
      if (cases.length > WORKFLOW_MAX_SWITCH_CASES) {
        report('plugins.workflows.node.switch.tooManyCases', ['cases'], {
          max: WORKFLOW_MAX_SWITCH_CASES,
        });
      }
      const ids = new Set<string>();
      for (const [i, entry] of cases.entries()) {
        const id = str(entry?.id);
        if (!CASE_ID.test(id) || id === WORKFLOW_SWITCH_DEFAULT_PORT) {
          report('plugins.workflows.node.switch.caseIdInvalid', ['cases', i, 'id'], { id });
        } else if (ids.has(id)) {
          report('plugins.workflows.node.switch.caseIdDuplicate', ['cases', i, 'id'], { id });
        }
        ids.add(id);
        if (!(WORKFLOW_CONDITION_OPERATORS as readonly unknown[]).includes(entry?.operator)) {
          report('plugins.workflows.rule.operatorUnknown', ['cases', i, 'operator'], {
            operator: entry?.operator,
          });
        }
      }
    },
    read: (raw) => ({ field: str(raw.field).trim(), cases: readCases(raw.cases) }),
    design: {
      fields: `"field": "<path into the run, e.g. content.fields.category>", "cases": [{"id": "<port name: lowercase letters, digits, _>", "label": "<short text>", "operator": "<one of ${WORKFLOW_CONDITION_OPERATORS.join(', ')}>", "value": "<text; placeholders allowed>"}] (at most ${WORKFLOW_MAX_SWITCH_CASES})`,
      hint: `compares one value with each case in turn and continues by the port named after the first case that holds, or by port "${WORKFLOW_SWITCH_DEFAULT_PORT}" when none does.`,
    },
  },
  delay: {
    label: 'Wait',
    description: 'Pauses the run for a while, then carries on.',
    ports: () => WORKFLOW_DELAY_PORTS,
    defaultPort: 'out',
    designPort: 'out',
    portRequired: false,
    branches: {},
    pauses: true,
    templateFields: () => [],
    idRefs: noRefs,
    check: (node, report) => {
      if (!inRange(Number(node.minutes), 1, WORKFLOW_MAX_DELAY_MINUTES)) {
        report('plugins.workflows.node.delay.minutesInvalid', ['minutes'], {
          max: WORKFLOW_MAX_DELAY_MINUTES,
        });
      }
    },
    read: (raw) => ({
      minutes: Math.min(
        Math.max(Math.round(Number(raw.minutes) || 10), 1),
        WORKFLOW_MAX_DELAY_MINUTES,
      ),
    }),
    design: {
      fields: `"minutes": <1 to ${WORKFLOW_MAX_DELAY_MINUTES}>`,
      hint: 'waits, then continues by port "out". Never inside a loop.',
    },
  },
  loop: {
    label: 'Loop',
    description: 'Runs its branch for each item of a list, a number of times, or until rules hold.',
    ports: (node) => [
      {
        name: 'each',
        label: WORKFLOW_LOOP_EACH_LABELS[node.mode] ?? 'For each item',
        type: 'json',
      },
      { name: 'done', label: 'After the last', type: 'json' },
    ],
    defaultPort: 'done',
    designPort: 'each',
    portRequired: false,
    branches: { each: 'each' },
    pauses: false,
    templateFields: (node) => [
      { at: ['items'], value: node.items },
      { at: ['count'], value: node.count },
      ...(node.until?.rules ?? []).flatMap((rule, i) => [
        { at: ['until', 'rules', i, 'field'], value: rule.field },
        { at: ['until', 'rules', i, 'value'], value: rule.value },
      ]),
    ],
    idRefs: noRefs,
    check: (node, report) => {
      const maxItems = Number(node.maxItems);
      if (!Number.isInteger(maxItems) || !inRange(maxItems, 1, WORKFLOW_MAX_LOOP_ITEMS)) {
        report('plugins.workflows.node.loop.maxItemsInvalid', ['maxItems'], {
          max: WORKFLOW_MAX_LOOP_ITEMS,
        });
      }
      if (node.mode === 'count' && !str(node.count).trim()) {
        report('plugins.workflows.node.loop.countRequired', ['count']);
      }
      if (node.mode === 'until') {
        checkRuleSet(record(node.until), (key, at, params) =>
          report(key, ['until', ...at], params),
        );
      }
    },
    read: (raw) => ({
      mode: (WORKFLOW_LOOP_MODES as readonly unknown[]).includes(raw.mode)
        ? (raw.mode as WorkflowLoopMode)
        : 'items',
      items: str(raw.items).trim(),
      count: (typeof raw.count === 'number' ? String(raw.count) : str(raw.count)).trim(),
      until: readRuleSet(record(raw.until)),
      maxItems: Math.min(
        Math.max(Math.round(Number(raw.maxItems) || WORKFLOW_DEFAULT_LOOP_ITEMS), 1),
        WORKFLOW_MAX_LOOP_ITEMS,
      ),
    }),
    design: {
      fields: `"mode": "items" | "count" | "until", "items": "<items mode: a placeholder for a list, e.g. {{ nodes.write.json }}; empty takes the list the previous step produced>", "count": "<count mode: a number or a placeholder for one>", "until": <until mode: {"match": "all" | "any", "rules": [<rules as on a condition>]}, checked after each pass>, "maxItems": <1 to ${WORKFLOW_MAX_LOOP_ITEMS}; the most items or passes>`,
      hint: 'runs the steps linked to its port "each" once per item ("items"), a number of times ("count"), or again and again until its rules hold ("until"), then continues by port "done". In those steps {{ item }} is the current item (its place from 0 when counting or repeating), {{ item.<name> }} one of its values and {{ loop.index }} its place from 0; a step after "each" must not be reached any other way. Afterwards {{ nodes.<loop key>.count }} and {{ nodes.<loop key>.results }} hold what every pass produced.',
    },
  },
  call: {
    label: 'Run a workflow',
    description: 'Runs another workflow of the space and hands on what it returns.',
    ports: () => WORKFLOW_CALL_PORTS,
    defaultPort: 'ok',
    designPort: 'ok',
    portRequired: false,
    branches: { onError: 'error' },
    pauses: false,
    templateFields: (node) => [{ at: ['input'], value: node.input }],
    idRefs: (node) => [{ kind: 'workflow', field: 'workflowId', id: node.workflowId }],
    check: noCheck,
    read: (raw) => ({
      workflowId: str(raw.workflowId) || null,
      input: inputRows(raw.input),
      wait: raw.wait !== false,
    }),
    design: {
      fields:
        '"workflow": "<name of a workflow it can run>", "input": {"<parameter name>": "<text; placeholders allowed>"}, "wait": true | false',
      hint: 'runs another workflow. Waiting, it continues by port "ok" with {{ nodes.<key>.output }} once that run ends, or by port "error" when it fails; otherwise it continues by "ok" at once.',
    },
  },
  stop: {
    label: 'Stop the run',
    description: 'Ends the whole run here, as done or as failed.',
    ports: () => [],
    defaultPort: '',
    designPort: '',
    portRequired: true,
    branches: {},
    pauses: false,
    templateFields: (node) => [{ at: ['message'], value: node.message }],
    idRefs: noRefs,
    check: noCheck,
    read: (raw) => ({
      outcome: raw.outcome === 'failed' ? 'failed' : 'succeeded',
      message: str(raw.message).trim(),
    }),
    design: {
      fields: '"outcome": "succeeded" | "failed", "message": "<why; placeholders allowed>"',
      hint: 'ends the whole run, every branch included; nothing may follow it.',
    },
  },
};

const specOf = (kind: WorkflowNodeKind) =>
  WORKFLOW_NODE_SPECS[kind] as unknown as WorkflowNodeSpec<WorkflowNodeKind>;

export const isWorkflowNodeKind = (value: unknown): value is WorkflowNodeKind =>
  (WORKFLOW_NODE_KINDS as readonly unknown[]).includes(value);

/** The action type an action node runs; null on every other kind. */
export const workflowNodeAction = (node: WorkflowNode): string | null =>
  node.kind === 'action' ? node.action : null;

/** Every port a node offers. */
export const workflowNodePorts = (
  node: WorkflowNode,
  action?: Pick<WorkflowActionMeta, 'output' | 'ports'> | null,
): WorkflowPortSpec[] => specOf(node.kind).ports(node, action);

/** What a node goes by when it has no name: its action's label, or its kind's. */
export const workflowNodeLabel = (
  node: WorkflowNode,
  action?: Pick<WorkflowActionMeta, 'label'> | null,
): string => action?.label ?? workflowNodeAction(node) ?? WORKFLOW_NODE_SPECS[node.kind].label;

export const workflowNodeTemplateFields = (node: WorkflowNode): WorkflowTemplateField[] =>
  specOf(node.kind).templateFields(node);

export const workflowNodeIdRefs = (node: WorkflowNode): WorkflowNodeIdRef[] =>
  specOf(node.kind).idRefs(node);

/** The node with each id ref replaced; `remap` returns the new id or null. */
export function remapNodeIds(
  node: WorkflowNode,
  remap: (ref: WorkflowNodeIdRef) => string | null,
): WorkflowNode {
  const refs = workflowNodeIdRefs(node).filter((ref) => ref.id);
  if (!refs.length) return node;
  const next: Record<string, unknown> = { ...node };
  for (const ref of refs) next[ref.field] = remap(ref);
  return next as unknown as WorkflowNode;
}

export const checkWorkflowNode = (node: WorkflowNode, report: WorkflowNodeReport): void =>
  specOf(node.kind).check(node, report);

/** A node of `kind` from its base and loose JSON, snapped to the canvas grid. */
export const readWorkflowNode = <K extends WorkflowNodeKind>(
  kind: K,
  base: WorkflowNodeBase,
  raw: Record<string, unknown>,
): WorkflowNodeOf<K> =>
  ({
    ...base,
    ui: snapWorkflowPosition(base.ui),
    kind,
    ...WORKFLOW_NODE_SPECS[kind].read(raw),
  }) as unknown as WorkflowNodeOf<K>;

// --- trigger kinds -------------------------------------------------------------------

/** A trigger kind's name: a built-in one or one a plugin contributes. */
export type WorkflowTriggerKind = keyof WorkflowTriggerKinds | (string & Record<never, never>);

/** A built-in trigger kind. */
export type WorkflowBuiltinTriggerKind = 'event' | 'schedule' | 'call' | 'manual';

/** A trigger kind as the editor, the AI designer and the catalogue describe it. */
export interface WorkflowTriggerSpec {
  label: string;
  hint: string;
  /** Whether it can also stop runs, as an abort trigger. */
  aborts: boolean;
  /** Label and hint as an abort trigger, where they differ from `label` and `hint`. */
  abortLabel?: string;
  abortHint?: string;
  /** Run context entries filled only by this kind of start. */
  context: readonly string[];
  /** For the AI designer: the trigger's JSON fields and when it starts. */
  design: { fields: string; hint: string };
  /** As an abort trigger, for the AI designer. */
  abortDesign: { fields: string; hint: string } | null;
}

/** The abort trigger fields every kind shares, for the AI designer. */
export const WORKFLOW_ABORT_MATCH_DESIGN =
  '"filter": null, "match": "all" | "document" | {"runKey": "<placeholder on the run, e.g. {{ nodes.create_order.body.id }}>", "abortKey": "<placeholder on the abort, e.g. {{ payload.body.orderId }}>"}';

/** The built-in trigger kinds; plugins contribute more through the `triggers` extension point. */
export const WORKFLOW_TRIGGER_SPECS: Record<WorkflowBuiltinTriggerKind, WorkflowTriggerSpec> = {
  event: {
    label: 'When content changes',
    hint: 'A document is created, saved, published or deleted.',
    aborts: true,
    abortLabel: 'When an event happens',
    abortHint: 'A document changes, or something happens elsewhere in the system.',
    context: ['content', 'previous', 'actor', 'url'],
    design: {
      fields: `"events": [<one or more of ${CONTENT_EVENTS.join(', ')}>], "types": [<document type names; empty for every type>], "locales": [<empty for every locale>]`,
      hint: 'a document changed.',
    },
    abortDesign: {
      fields: `"events": [<one or more of ${WORKFLOW_ABORT_EVENTS.join(', ')}>], "types": [<document type names; empty for every type>], ${WORKFLOW_ABORT_MATCH_DESIGN}`,
      hint: 'stops the active runs on a system event; "document" stops the runs about the same document, content events only.',
    },
  },
  schedule: {
    label: 'On a schedule',
    hint: 'Every few minutes, hourly, daily, or a cron expression.',
    aborts: false,
    context: ['documents', 'content'],
    design: {
      fields:
        '"cron": "<five-field cron>", "timezone": "<IANA zone, e.g. Europe/Vienna>", "selection": null or {"types": [<document type names>], "status": "any" | "draft" | "published", "changedWithinHours": <hours or null>, "locale": null}, "perDocument": <true to run the steps once per selected document>',
      hint: 'on a schedule.',
    },
    abortDesign: null,
  },
  call: {
    label: 'When another workflow runs it',
    hint: 'A step other workflows share: they hand it values and get its result back.',
    aborts: false,
    context: ['input', 'caller'],
    design: {
      fields:
        '"parameters": [{"name": "<letters, digits, _>", "description": "<what it is>", "required": true | false}], "output": "<what callers get back, e.g. {{ nodes.write.text }}; empty hands back every step\'s output>"',
      hint: 'another workflow\'s "call" step runs it; it reads {{ input.<parameter> }}.',
    },
    abortDesign: null,
  },
  manual: {
    label: 'When someone runs it',
    hint: 'Started by hand from the admin or the API, with the values it asks for.',
    aborts: false,
    context: ['input', 'actor'],
    design: {
      fields:
        '"parameters": [{"name": "<letters, digits, _>", "description": "<what it is>", "required": true | false}]',
      hint: 'a person starts it by hand; it reads {{ input.<parameter> }} and {{ actor.name }}.',
    },
    abortDesign: null,
  },
};

/** The built-in trigger kinds, in the editor's order. */
export const WORKFLOW_TRIGGER_KINDS = Object.keys(
  WORKFLOW_TRIGGER_SPECS,
) as WorkflowBuiltinTriggerKind[];

export const isWorkflowTriggerKind = (value: unknown): value is WorkflowBuiltinTriggerKind =>
  (WORKFLOW_TRIGGER_KINDS as readonly unknown[]).includes(value);

/** Built-in trigger kinds that can also be abort triggers. */
export const WORKFLOW_ABORT_TRIGGER_KINDS = WORKFLOW_TRIGGER_KINDS.filter(
  (kind) => WORKFLOW_TRIGGER_SPECS[kind].aborts,
);
