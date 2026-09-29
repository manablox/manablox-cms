import { type ContentTypeDefinition, isDocumentType } from '@manablox/core';
import {
  WORKFLOW_NODE_KINDS,
  WORKFLOW_NODE_SPECS,
  WORKFLOW_TRIGGER_ID,
  WORKFLOW_TRIGGER_PORTS,
  type WorkflowActionMeta,
  type WorkflowNode,
  workflowNodePorts,
} from '../sdk.js';
import type { WorkflowRegistry } from './registry.js';
import type { WorkflowCatalog } from './services/workflow.service.js';

/** What the designer is told about the space. */
export interface WorkflowDesignContext {
  catalog: WorkflowCatalog;
  contentTypes: readonly ContentTypeDefinition[];
  /** Trigger kinds and the plugins' design hints. */
  registry: WorkflowRegistry;
}

export const WORKFLOW_DESIGN_SYSTEM = [
  'You design automation workflows for Manablox, a headless CMS.',
  'You answer with one JSON object and nothing else: no markdown fence, no commentary.',
  'You use only the triggers, actions, fields and operators you are given, and the smallest workflow that does what was asked.',
].join(' ');

const quoted = (names: readonly string[]): string => names.map((name) => `"${name}"`).join(', ');
const a = (word: string): string => `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`;

export function composeWorkflowDesignPrompt(
  request: string,
  context: WorkflowDesignContext,
): string {
  const { catalog, registry } = context;
  const actions = catalog.actions.filter((action) => action.available);
  const documents = context.contentTypes.filter((type) => isDocumentType(type) && !type.isSystem);
  const callable = catalog.callable ?? [];
  const kinds = registry.triggerKinds.filter((kind) => kind.design);
  const hints = (section: 'placeholders' | 'actions') =>
    registry.designHints.filter((hint) => hint.section === section).map((hint) => hint.text);

  return [
    'A workflow has one trigger and a list of steps. The trigger starts a run; each step runs after the steps it names in "after", and passes what it produced on to the steps after it.',
    [
      'Triggers - exactly one, as "trigger":',
      ...kinds.map(
        ({ kind, spec }) => `- {"kind": "${kind}", ${spec.design.fields}}: ${spec.design.hint}`,
      ),
      ...kinds.flatMap((kind) => kind.design?.prompt?.(catalog.triggers[kind.kind]) ?? []),
    ].join('\n'),
    [
      'Abort triggers - optional, as "abortTriggers": a list of what stops the active runs early, e.g. an order cancelled before its reminder is sent:',
      ...kinds.flatMap(({ kind, spec: { abortDesign } }) =>
        abortDesign && registry.abortTrigger(kind)?.design
          ? [`- {"kind": "${kind}", ${abortDesign.fields}}: ${abortDesign.hint}`]
          : [],
      ),
      '- "key" stops only the runs whose "runKey" renders to what "abortKey" renders to on the abort.',
    ].join('\n'),
    [
      'Steps - each an object in "steps":',
      ...WORKFLOW_NODE_KINDS.map((kind, index) => {
        const { design } = WORKFLOW_NODE_SPECS[kind];
        const key =
          index === 0
            ? '"key": "<unique, lowercase, a-z0-9_, starting with a letter>", "name": "<short description>"'
            : '"key", "name"';
        return `- {${key}, "kind": "${kind}", ${design.fields}, "after": [<links>]}: ${design.hint}`;
      }),
      callable.length
        ? `- A "call" step can run these workflows: ${callable.map(describeCallable).join('; ')}.`
        : '- No workflow here can be run by a "call" step; do not use one.',
      '- A config field of kind keyValue is a list of rows: [{"name": "<key>", "value": "<text; placeholders allowed>"}].',
      `- A link is {"step": "<key of an earlier step, or ${WORKFLOW_TRIGGER_ID}>", "port": "<port>"}. Ports: ${describePorts()}. The first step follows {"step": "${WORKFLOW_TRIGGER_ID}", "port": "${WORKFLOW_TRIGGER_PORTS[0]?.name}"}.`,
      `- A link without a port leaves by ${describeDesignPorts()}.`,
      '- Links must not lead in a circle (a loop step repeats without one), and every step must be reached from the trigger.',
    ].join('\n'),
    [
      'Placeholders: text fields may use {{ path }} to read the run - never logic, only paths:',
      '- {{ content.title }}, {{ content.slug }}, {{ content.status }}, {{ content.locale }}, {{ content.fields.<field name> }}: the document that changed.',
      '- {{ previous.fields.<name> }}: the document before the save; {{ actor.name }}, {{ actor.email }}: who changed it; {{ url }}: its admin URL; {{ space.name }}, {{ at }}.',
      '- {{ documents }}: the selected documents on a schedule; {{ input.<parameter> }}: what the calling workflow, or the person starting it by hand, handed over.',
      '- {{ nodes.<step key>.<output path> }}: what an earlier step produced - only steps that run before this one.',
      '- A step sees nothing an earlier step produced unless a placeholder puts it there. A prompt that works on fetched, crawled or earlier text must include it, e.g. "Summarise this: {{ nodes.crawl.text }}" - never "this content" without the placeholder.',
      ...hints('placeholders'),
    ].join('\n'),
    ['Actions:', ...actions.map(describeAction), ...hints('actions')].join('\n'),
    catalog.credentials.length
      ? `Credentials in this space, by name: ${catalog.credentials.map((entry) => `"${entry.name}" (${entry.kind})`).join(', ')}. A step whose action requires a credential must name one of the right kind; if none fits, leave that action out and say so in "notes".`
      : 'This space has no credentials; do not use an action that requires one, and say in "notes" what the editor would have to add.',
    documents.length
      ? [
          'Document types, with their fields:',
          ...documents.map(
            (type) =>
              `- "${type.name}" (${type.label}): ${type.fields.map((field) => `${field.name} (${field.type})`).join(', ') || 'no fields'}`,
          ),
        ].join('\n')
      : '',
    `Answer with a single JSON object: {"name": "<the workflow's name>", "description": "<one sentence>", "trigger": {...}, "abortTriggers": [...], "steps": [...], "notes": "<one or two sentences to the editor: what it does, and what they must check or fill in>"}. Leave "abortTriggers" empty unless the request says what should stop a run. Where a value is only known to the editor - an address, a URL - use a sensible placeholder and mention it in "notes".`,
    `The request: ${request.trim()}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** `"ok" and "error" on an action; "true" and "false" on a condition; ...` */
function describePorts(): string {
  const trigger = `${quoted(WORKFLOW_TRIGGER_PORTS.map((port) => port.name))} on the trigger`;
  const nodes = WORKFLOW_NODE_KINDS.flatMap((kind) => {
    // An action's and a switch's own ports depend on the node; their fields name those.
    const ports = workflowNodePorts({ kind, cases: [] } as unknown as WorkflowNode).map(
      (port) => port.name,
    );
    if (!ports.length) return [];
    const listed = quoted(ports).replace(/, (?=[^,]*$)/, ' and ');
    return kind === 'switch'
      ? [`each case's "id" and ${listed} on a switch`]
      : [`${listed} on ${a(kind)}`];
  });
  return [trigger, ...nodes].join('; ');
}

function describeDesignPorts(): string {
  return WORKFLOW_NODE_KINDS.filter((kind) => WORKFLOW_NODE_SPECS[kind].designPort)
    .map((kind) => `"${WORKFLOW_NODE_SPECS[kind].designPort}" from ${a(kind)}`)
    .join(', ');
}

function describeCallable(entry: WorkflowCatalog['callable'][number]): string {
  const parameters = entry.parameters.map(
    (parameter) => `${parameter.name}${parameter.required ? ' (required)' : ''}`,
  );
  return `"${entry.name}"${parameters.length ? ` (input: ${parameters.join(', ')})` : ''}`;
}

/** `- "email" (Send an email) - ... fields: to (list, required), subject (text) ... outputs: ...` */
function describeAction(action: WorkflowActionMeta): string {
  const fields = action.fields
    .filter((field) => !field.name.includes('.'))
    .map((field) => {
      const options = field.options?.length
        ? ` one of ${field.options.map((option) => JSON.stringify(option.value)).join('|')}`
        : '';
      return `${field.name} (${field.kind}${options}${field.required ? ', required' : ''})`;
    })
    .join(', ');
  const credential = action.credential
    ? ` Credential: ${action.credential.required ? 'required' : 'optional'}, of kind ${action.credential.kinds.join(' or ')}.`
    : '';
  const outputs = action.outputPaths.length
    ? ` Outputs: ${action.outputPaths.map((path) => path.path).join(', ')}.`
    : '';
  const ports = action.ports.length
    ? ` Extra ports: ${quoted(action.ports.map((port) => port.name))}.`
    : '';
  return `- "${action.type}" (${action.label}) - ${action.description} Config fields: ${fields || 'none'}. Defaults: ${JSON.stringify(action.defaults)}.${credential}${outputs}${ports}`;
}
