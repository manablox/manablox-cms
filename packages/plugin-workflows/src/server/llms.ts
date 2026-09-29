import { CONTENT_EVENTS, type PluginLlmsContext } from '@manablox/core';
import { WORKFLOW_CONDITION_OPERATORS, type WorkflowActionMeta } from '../sdk.js';
import type { WorkflowsServices } from './services/index.js';

/** The workflows plugin's section of the LLM guide: building, running and reading workflows. */
export function workflowLlms({ complete, plugin }: PluginLlmsContext<WorkflowsServices>): string {
  const { registry } = plugin.services;
  const kinds = registry.triggerKinds.map((kind) => kind.kind);
  const sections = [
    '### Workflows',
    '',
    `A **workflow** is a trigger (one of ${kinds.map((kind) => `\`${kind}\``).join(', ')}: a content event, a schedule, a call from another workflow, a start by hand, and what plugins add) and a graph of steps (actions, conditions, delays, loops, calls). Its procedures are under \`plugins.workflows\`.`,
    '',
    '`plugins.workflows.create` takes `{spaceId, name, description, enabled, trigger, nodes, edges}`. `plugins.workflows.catalog` returns every trigger kind and event, action (with its config fields and defaults), condition operator and credential of the space, and what each trigger kind may point at. A node is `{"id": "<uuid>", "key": "notify", "name": "", "kind": "action", "action": "email", "config": {...}, "credentialId": null, "enabled": true, "continueOnError": false, "join": "any", "ui": {"x": 0, "y": 176}}` (or `kind: "condition"` with `match` and `rules`, or `kind: "delay"` with `minutes`). An edge is `{"id": "<uuid>", "from": "trigger" or a node id, "fromPort": "out" | "ok" | "error" | "true" | "false", "to": "<node id>", "guard": null}`. Text in a config may read the run with `{{ content.title }}`, `{{ content.fields.<name> }}` or `{{ nodes.<key>.<output> }}`. `plugins.workflows.create` and `plugins.workflows.update` save a draft the trigger does not run; `plugins.workflows.publish` (or `publish: true` on the save) makes it the live version. Create workflows with `enabled: false`, unpublished, and let a person publish and switch them on. `plugins.workflows.runNow` test-runs the draft, with `contentId`, `input` or a sample call in `payload`; `plugins.workflows.runHistory` and `plugins.workflows.run` read what runs did, step by step.',
    '',
    '- `plugins.workflows.design` `{spaceId, prompt}` returns a checked, switched-off `workflow` for `plugins.workflows.create`, where a plugin that designs is on.',
    '- `abortTriggers` on a workflow stop its active runs: `{"id": "", "kind": "event", "events": ["content.deleted"], "typeIds": [], "locales": [], "filter": null, "match": {"mode": "document", "runKey": "", "abortKey": ""}}`, or another kind a plugin adds. `match.mode` is `all`, `document` (content events) or `key` (`runKey` rendered on the run equals `abortKey` rendered on the event or call).',
    '- `plugins.workflows.abortRun` `{spaceId, id}` stops one run; `plugins.workflows.abortRuns` `{spaceId, id}` stops every active run of a workflow.',
    '- `plugins.workflows.export` `{spaceId, id}` returns a portable file; `plugins.workflows.import` `{spaceId, file}` creates it switched off, matching credentials and what its triggers point at by slug.',
    '- A sub-workflow has `trigger: {"kind": "call", "parameters": [{"name": "orderId", "description": "", "required": true}], "output": "{{ nodes.shape }}"}` and reads `{{ input.orderId }}`. Another workflow runs it with `{"kind": "call", "workflowId": "<id>", "input": [{"name": "orderId", "value": "{{ content.id }}"}], "wait": true, ...}`, ports `ok` and `error`; with `wait` the result is `{{ nodes.<key>.output }}`. `plugins.workflows.catalog` lists them as `callable`, and `plugins.workflows.runNow` takes their values as `input`.',
    '- A workflow started by hand has `trigger: {"kind": "manual", "parameters": [...]}`, parameters as above, and reads `{{ input.<name> }}` and `{{ actor.name }}`. `plugins.workflows.start` `{spaceId, id, input}` queues a run of its live version; it must be published and switched on.',
  ];
  if (complete) {
    sections.push(
      '',
      '#### Workflow triggers and actions',
      '',
      `Trigger events: ${CONTENT_EVENTS.map((event) => `\`${event}\``).join(', ')}. Schedule triggers take a five-field \`cron\` and a \`timezone\`. Condition operators: ${WORKFLOW_CONDITION_OPERATORS.map((operator) => `\`${operator}\``).join(', ')}.`,
      '',
      ...registry.actions.catalog(plugin.manablox).map(describeAction),
    );
  }
  return sections.join('\n');
}

function describeAction(action: WorkflowActionMeta): string {
  const fields = action.fields
    .filter((field) => !field.name.includes('.'))
    .map((field) => `${field.name}${field.required ? ' (required)' : ''}`)
    .join(', ');
  const credential = action.credential
    ? ` Credential: ${action.credential.required ? 'required' : 'optional'}, ${action.credential.kinds.join(' or ')}.`
    : '';
  const outputs = action.outputPaths.length
    ? ` Outputs: ${action.outputPaths.map((path) => `\`${path.path}\``).join(', ')}.`
    : '';
  return `- \`${action.type}\` (${action.label}): ${action.description} Config: ${fields || 'none'}; defaults \`${JSON.stringify(action.defaults)}\`.${credential}${outputs}`;
}
