import { plainClone } from '@manablox/admin-sdk';
import type { FeatureKey } from '@manablox/core';
import {
  readWorkflowNode,
  snapWorkflowPosition,
  WORKFLOW_NODE_SPECS,
  WORKFLOW_TRIGGER_ID,
  WORKFLOW_TRIGGER_PORTS,
  type WorkflowActionMeta,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowNodeKind,
  type WorkflowNodeOf,
  type WorkflowNodeSpec,
  type WorkflowPortSpec,
  type WorkflowRuleSet,
  workflowNodeLabel,
  workflowNodePorts,
} from '../../sdk';
import type { workflowKeys } from '../../server/keys';
import type { WorkflowTone } from '../slots';

type WorkflowKeys = typeof workflowKeys;

export type Tone = WorkflowTone;

/** The plugin's flags of its HTTP and mail nodes. */
/** Typed by the server's declaration, so a key it does not declare fails to compile. */
export const WORKFLOWS_HTTP: WorkflowKeys['features']['http'] = 'plugins.workflows.http';
export const WORKFLOWS_MAIL: WorkflowKeys['features']['mail'] = 'plugins.workflows.mail';

/** Built-in actions behind a feature flag, as the server refuses them. */
const ACTION_FEATURES: Record<string, FeatureKey> = {
  http: WORKFLOWS_HTTP,
  'crawl.site': WORKFLOWS_HTTP,
  email: WORKFLOWS_MAIL,
  'mail.send': WORKFLOWS_MAIL,
  'gmail.send': WORKFLOWS_MAIL,
};

/** The flag an action needs: its catalogue entry's (a plugin's action), else a built-in one's. */
export const actionFeature = (
  type: string,
  meta?: Pick<WorkflowActionMeta, 'feature'> | null,
): FeatureKey | null => meta?.feature ?? ACTION_FEATURES[type] ?? null;

/** Tile class per tone. */
const TILES: Record<Tone, string> = {
  clay: 'mb-tile-clay',
  iris: 'mb-tile-iris',
  ochre: 'mb-tile-ochre',
  sand: 'mb-tile-sand',
  plain: 'wf:bg-surface-200 wf:text-surface-700 wf:dark:bg-surface-800 wf:dark:text-surface-300',
};

/** Hue names actions may declare, as the tone they alias. */
const TONE_ALIASES: Record<string, Tone> = {
  violet: 'clay',
  cyan: 'iris',
  pink: 'ochre',
  amber: 'sand',
};

/** A declared tone as one of ours; unknown ones are plain. */
export function toneOf(tone: string | null | undefined): Tone {
  const name = TONE_ALIASES[tone ?? ''] ?? tone;
  return name && name in TILES ? (name as Tone) : 'plain';
}

export const toneClass = (tone: string | null | undefined): string => TILES[toneOf(tone)];

/** A rule set with one `equals` rule on `field`. */
export function newRuleSet(field: string, value = ''): WorkflowRuleSet {
  return { match: 'all', rules: [{ field, operator: 'equals', value }] };
}

const nodeBase = (key: string, at: { x: number; y: number }) => ({
  id: crypto.randomUUID(),
  key,
  name: '',
  enabled: true,
  continueOnError: false,
  join: 'any' as const,
  ui: snapWorkflowPosition(at),
});

/** A key nothing else uses, derived from the node so templates read as `{{ nodes.crawl_site.text }}`. */
function uniqueKey(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const root =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32) || 'node';
  if (!used.has(root)) return root;
  for (let n = 2; ; n++) {
    const candidate = `${root}_${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

export function newActionNode(
  meta: WorkflowActionMeta,
  at: { x: number; y: number },
  taken: Iterable<string>,
): WorkflowNode {
  return {
    ...nodeBase(uniqueKey(meta.type.replace(/\./g, '_'), taken), at),
    kind: 'action',
    action: meta.type,
    config: plainClone(meta.defaults) as Record<string, unknown>,
    credentialId: null,
  };
}

/** A control node as the admin shows it; label, description and ports come from core. */
export interface ControlNodeUi<K extends ControlNodeKind = ControlNodeKind>
  extends WorkflowNodeSpec<K> {
  kind: K;
  icon: string;
  tone: Tone;
  /** Extra words the palette search matches. */
  keywords: string;
  create: (at: { x: number; y: number }, taken: Iterable<string>) => WorkflowNodeOf<K>;
}

/** Every node kind but actions, which come from the action catalogue. */
export type ControlNodeKind = Exclude<WorkflowNodeKind, 'action'>;

const controlNode = <K extends ControlNodeKind>(
  kind: K,
  icon: string,
  tone: Tone,
  keywords: string,
  key: string,
  fields: Record<string, unknown> = {},
): ControlNodeUi<K> => ({
  ...(WORKFLOW_NODE_SPECS[kind] as WorkflowNodeSpec<K>),
  kind,
  icon,
  tone,
  keywords,
  create: (at, taken) => readWorkflowNode(kind, nodeBase(uniqueKey(key, taken), at), fields),
});

/** In palette order. */
export const CONTROL_NODES: { [K in ControlNodeKind]: ControlNodeUi<K> } = {
  call: controlNode('call', 'workflow', 'ochre', 'call sub', 'run'),
  condition: controlNode('condition', 'filter', 'sand', 'condition if', 'check', {
    ...newRuleSet('content.status', 'published'),
  }),
  switch: controlNode('switch', 'split', 'sand', 'switch case decision route branch', 'route', {
    field: 'content.typeId',
    cases: [{ id: 'case_1', label: '', operator: 'equals', value: '' }],
  }),
  loop: controlNode('loop', 'repeat', 'sand', 'loop repeat for each times until while', 'each'),
  delay: controlNode('delay', 'hourglass', 'sand', 'delay', 'wait'),
  stop: controlNode('stop', 'stop', 'sand', 'stop end finish fail exit', 'stop'),
};

export type AnyControlNode = (typeof CONTROL_NODES)[ControlNodeKind];

export const CONTROL_NODE_LIST: AnyControlNode[] = Object.values(CONTROL_NODES);

export const newEdge = (from: string, fromPort: string, to: string): WorkflowEdge => ({
  id: crypto.randomUUID(),
  from,
  fromPort,
  to,
  guard: null,
});

/** The action a node runs, from the catalogue; null on control nodes and unknown actions. */
const metaOf = (node: WorkflowNode, actions: WorkflowActionMeta[]) =>
  node.kind === 'action' ? (actions.find((action) => action.type === node.action) ?? null) : null;

/** What a node is called when it has no name of its own. */
export function nodeLabel(node: WorkflowNode, actions: WorkflowActionMeta[]): string {
  return node.name || workflowNodeLabel(node, metaOf(node, actions));
}

/** A node's sockets in draw order. An unknown action still gets the standard two, so its edges stay visible. */
export function portsOf(
  node: WorkflowNode | null,
  actions: WorkflowActionMeta[],
): WorkflowPortSpec[] {
  return node ? workflowNodePorts(node, metaOf(node, actions)) : WORKFLOW_TRIGGER_PORTS;
}

/** The first unused socket, so a second node after a fork takes its other side; else the first. */
export function freePort(
  node: WorkflowNode | null,
  actions: WorkflowActionMeta[],
  edges: WorkflowEdge[],
): string {
  const ports = portsOf(node, actions);
  const from = node?.id ?? WORKFLOW_TRIGGER_ID;
  const taken = new Set(edges.filter((edge) => edge.from === from).map((edge) => edge.fromPort));
  const open = ports.find((port) => !taken.has(port.name));
  return (open ?? ports[0])?.name ?? 'ok';
}

/** The drag data type of a palette entry. */
export const PALETTE_DRAG_TYPE = 'application/x-manablox-workflow-node';

/** What a palette entry carries while dragged onto the canvas. */
export type PaletteEntry =
  | { kind: 'action'; type: string }
  | { kind: 'control'; control: ControlNodeKind };
