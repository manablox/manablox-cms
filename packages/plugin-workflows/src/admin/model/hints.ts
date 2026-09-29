import {
  loopBody,
  type WorkflowAbortTrigger,
  type WorkflowActionMeta,
  type WorkflowNode,
  type WorkflowNodeOf,
  type WorkflowTrigger,
} from '../../sdk';
import type { WorkflowPlaceholderHint } from '../slots';
import type { Draft } from './draft';
import { nodeLabel } from './nodes';
import { isBuiltinTriggerKind, type TriggerOf, triggerKind } from './triggers';

export type PlaceholderHint = WorkflowPlaceholderHint;

/** What an abort trigger's filter and abort key may read. */
export function abortHints(trigger: WorkflowAbortTrigger | { kind: string }): PlaceholderHint[] {
  const common: PlaceholderHint[] = [
    { path: 'event', hint: 'The event that fired, or what the abort trigger names' },
    { path: 'space.name', hint: 'The space' },
    { path: 'at', hint: 'When it happened, ISO 8601' },
  ];
  if (trigger.kind !== 'event' || !('events' in trigger)) {
    return triggerHints(trigger.kind).filter((hint) => !hint.path.startsWith('workflow.'));
  }
  const content = trigger.events.some((event) => event.startsWith('content.'));
  const hints: PlaceholderHint[] = [];
  if (content) {
    hints.push(
      { path: 'content.id', hint: 'The document' },
      { path: 'content.title', hint: '' },
      { path: 'content.fields.<name>', hint: 'Any field, by technical name' },
      { path: 'previous.fields.<name>', hint: 'The value before the save (updates)' },
      { path: 'actor.email', hint: 'Who made the change' },
    );
  }
  if (trigger.events.includes('workflow.finished')) {
    hints.push(
      { path: 'data.workflowId', hint: 'The workflow whose run ended' },
      { path: 'data.status', hint: 'succeeded, failed, skipped, aborted' },
      { path: 'data.runId', hint: '' },
    );
  }
  if (
    trigger.events.some((event) => !event.startsWith('content.') && event !== 'workflow.finished')
  ) {
    hints.push(
      { path: 'data.id', hint: 'The asset or menu' },
      { path: 'data.userId', hint: 'The member, on a role grant' },
      { path: 'data.role', hint: 'The role granted' },
    );
  }
  return [...hints, ...common];
}

/**
 * What a template may reach from the trigger alone; a call or manual trigger adds its
 * parameters, a contributed kind what its plugin lists.
 */
export function triggerHints(
  kind: string,
  trigger?: WorkflowTrigger | { kind: string } | undefined,
): PlaceholderHint[] {
  const common: PlaceholderHint[] = [
    { path: 'event', hint: 'content.created, content.updated, ..., schedule, call, manual' },
    { path: 'space.name', hint: 'The space' },
    { path: 'space.url', hint: 'Its public origin' },
    { path: 'workflow.name', hint: 'This workflow' },
    { path: 'at', hint: 'When the run started, ISO 8601' },
  ];
  const document: PlaceholderHint[] = [
    { path: 'content.title', hint: 'The document' },
    { path: 'content.id', hint: '' },
    { path: 'content.status', hint: 'draft, published, changed' },
    { path: 'content.locale', hint: '' },
    { path: 'content.permalink', hint: 'Its path on the site' },
    { path: 'content.fields.<name>', hint: 'Any field, by technical name' },
    { path: 'content', hint: 'The whole document as JSON' },
    { path: 'url', hint: 'Its page in the admin' },
  ];
  if (!isBuiltinTriggerKind(kind)) return [...(triggerKind(kind).entry?.hints ?? []), ...common];
  if (kind === 'call') {
    const parameters = trigger?.kind === 'call' ? (trigger as TriggerOf<'call'>).parameters : [];
    return [
      ...parameters.map((parameter) => ({
        path: `input.${parameter.name}`,
        hint: parameter.description || 'A value the calling workflow hands over',
      })),
      { path: 'input', hint: 'Everything the calling workflow handed over' },
      { path: 'caller.workflowName', hint: 'The workflow that ran this one' },
      { path: 'caller.runId', hint: '' },
      ...document.map((entry) => ({ ...entry, hint: `${entry.hint} (the caller's)`.trim() })),
      ...common,
    ];
  }
  if (kind === 'manual') {
    const parameters =
      trigger?.kind === 'manual' ? (trigger as TriggerOf<'manual'>).parameters : [];
    return [
      ...parameters.map((parameter) => ({
        path: `input.${parameter.name}`,
        hint: parameter.description || 'A value asked for when it is started',
      })),
      { path: 'input', hint: 'Everything asked for when it was started' },
      { path: 'actor.name', hint: 'Who started it' },
      { path: 'actor.email', hint: '' },
      ...common,
    ];
  }
  if (kind === 'schedule') {
    return [
      ...common,
      { path: 'documents.length', hint: 'How many documents matched' },
      { path: 'documents', hint: 'The matching documents as JSON' },
      { path: 'documents.0.title', hint: 'The first of them' },
      ...document.map((entry) => ({ ...entry, hint: `${entry.hint} (per-document runs)`.trim() })),
    ];
  }
  return [
    ...document,
    { path: 'previous.fields.<name>', hint: 'The value before the save (updates)' },
    { path: 'actor.name', hint: 'Who made the change' },
    { path: 'actor.email', hint: '' },
    ...common,
  ];
}

/** What a node may reach: the trigger payload plus the output of every node that runs before it. */
export function hintsFor(
  draft: Pick<Draft, 'trigger' | 'nodes' | 'edges'>,
  nodeId: string | null,
  actions: WorkflowActionMeta[],
): PlaceholderHint[] {
  const hints = triggerHints(draft.trigger.kind, draft.trigger);
  if (!nodeId) return hints;

  for (const node of upstreamOf(draft, nodeId)) {
    hints.push(
      ...(node.kind === 'loop' && loopBody(draft, node.id).has(nodeId)
        ? passHints(node)
        : outputHints(node, actions)),
    );
  }
  return hints;
}

/** What a loop's repeat rules may read: what reaches the loop, its pass, and its own branch after it. */
export function untilHintsFor(
  draft: Pick<Draft, 'trigger' | 'nodes' | 'edges'>,
  loop: WorkflowNodeOf<'loop'>,
  actions: WorkflowActionMeta[],
): PlaceholderHint[] {
  const body = loopBody(draft, loop.id);
  return [
    ...hintsFor(draft, loop.id, actions),
    ...passHints(loop),
    ...draft.nodes
      .filter((node) => body.has(node.id))
      .flatMap((node) => outputHints(node, actions)),
  ];
}

/** What a node hands on to the nodes after it. */
function outputHints(node: WorkflowNode, actions: WorkflowActionMeta[]): PlaceholderHint[] {
  const label = nodeLabel(node, actions);
  const from = node.key;
  if (node.kind === 'loop') {
    return [
      { path: `nodes.${from}.count`, hint: 'How many passes it made', from },
      { path: `nodes.${from}.results`, hint: 'What every pass produced, by node key', from },
      ...(node.mode === 'until'
        ? [{ path: `nodes.${from}.met`, hint: 'Whether its rules held before the limit', from }]
        : []),
    ];
  }
  if (node.kind === 'switch') {
    return [
      { path: `nodes.${from}.label`, hint: 'The case it took, or Otherwise', from },
      { path: `nodes.${from}.case`, hint: "That case's port name", from },
      { path: `nodes.${from}.value`, hint: 'The value it compared', from },
    ];
  }
  if (node.kind === 'call') {
    return [
      { path: `nodes.${from}.output`, hint: `What ${label} handed back`, from },
      { path: `nodes.${from}.status`, hint: 'succeeded, skipped, or queued', from },
      { path: `nodes.${from}.runId`, hint: 'The run it started', from },
    ];
  }
  if (node.kind !== 'action') return [];
  const meta = actions.find((action) => action.type === node.action);
  return [
    { path: `nodes.${from}`, hint: `Everything ${label} produced`, from },
    ...(meta?.outputPaths ?? []).map((path) => ({
      path: `nodes.${from}.${path.path}`,
      hint: path.hint,
      from,
    })),
  ];
}

/** What a loop offers inside its branch. */
function passHints(loop: WorkflowNodeOf<'loop'>): PlaceholderHint[] {
  const from = loop.key;
  const items = (loop.mode ?? 'items') === 'items';
  return [
    items
      ? { path: 'item', hint: 'The current item', from }
      : { path: 'item', hint: 'The pass, from 0', from },
    ...(items
      ? [{ path: 'item.<name>', hint: 'One value of it, when it is an object', from }]
      : []),
    { path: 'loop.index', hint: 'The pass, from 0', from },
    ...(loop.mode === 'until'
      ? []
      : [
          {
            path: 'loop.count',
            hint: items ? 'How many items there are' : 'How many passes',
            from,
          },
        ]),
    { path: `nodes.${from}.item`, hint: "This loop's item, when loops nest", from },
  ];
}

/** The nodes that can reach this one, in the order the canvas draws them. */
function upstreamOf(draft: Pick<Draft, 'nodes' | 'edges'>, nodeId: string): WorkflowNode[] {
  const seen = new Set<string>();
  const queue = [nodeId];
  while (queue.length) {
    const current = queue.shift() as string;
    for (const edge of draft.edges) {
      if (edge.to !== current || seen.has(edge.from)) continue;
      seen.add(edge.from);
      queue.push(edge.from);
    }
  }
  seen.delete(nodeId);
  return draft.nodes.filter((node) => seen.has(node.id));
}
