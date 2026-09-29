import { humanise, parseCodeRef } from '@manablox/core';
import {
  type ConfigRenderContext,
  type ResourceConfigExport,
  runtimeOnly,
} from '@manablox/services';
import type { WorkflowDefinitionInput } from '../define/workflow.js';
import type { WorkflowCallParameter } from '../sdk.js';
import { stepsFromGraph } from './config-steps.js';
import { type WorkflowRow, workflowRepos } from './db/index.js';

/** Parameters as `defineWorkflow` takes them; a plain optional one as its bare name. */
function declaredParameters(parameters: WorkflowCallParameter[]) {
  if (!parameters.length) return {};
  return {
    parameters: parameters.map((parameter) =>
      parameter.required || parameter.description
        ? {
            name: parameter.name,
            ...(parameter.description ? { description: parameter.description } : {}),
            ...(parameter.required ? { required: true } : {}),
          }
        : parameter.name,
    ),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a value still holds a record id rather than a `ref.*` marker. */
function holdsId(value: unknown): boolean {
  if (typeof value === 'string') return UUID.test(value);
  if (Array.isArray(value)) return value.some(holdsId);
  if (value && typeof value === 'object') return Object.values(value).some(holdsId);
  return false;
}

/** The slug a `ref.*` marker of `id` names, when the export knows the id. */
const slugOf = (deref: ConfigRenderContext['deref'], id: string): string | null =>
  parseCodeRef(deref(id))?.name ?? null;

/** A workflow as `defineWorkflow` input, and notes on what code cannot say. */
function workflowInput(
  row: WorkflowRow,
  { slug, deref }: ConfigRenderContext,
): { input: WorkflowDefinitionInput; warnings: string[] } {
  const { steps, unexpressed } = stepsFromGraph(row.nodes, row.edges, {
    credentialSlug: (id) => slugOf(deref, id),
    workflowSlug: (id) => slugOf(deref, id),
    deref,
  });

  const trigger = row.trigger;
  let declared: WorkflowDefinitionInput['trigger'];
  if (trigger.kind === 'event') {
    declared = {
      kind: 'event',
      events: trigger.events,
      ...(trigger.typeIds.length ? { typeIds: deref(trigger.typeIds) } : {}),
      ...(trigger.locales.length ? { locales: trigger.locales } : {}),
    };
  } else if (trigger.kind === 'schedule') {
    declared = {
      kind: 'schedule',
      cron: trigger.cron,
      ...(trigger.timezone === 'UTC' ? {} : { timezone: trigger.timezone }),
      ...(trigger.selection ? { selection: deref(trigger.selection) } : {}),
      ...(trigger.perDocument ? { perDocument: true } : {}),
    };
  } else if (trigger.kind === 'call') {
    declared = {
      kind: 'call',
      ...declaredParameters(trigger.parameters),
      ...(trigger.output ? { output: trigger.output } : {}),
    };
  } else if (trigger.kind === 'manual') {
    declared = { kind: 'manual', ...declaredParameters(trigger.parameters) };
  } else {
    // A contributed kind as stored, the records it points at named by `ref`; an id left
    // over points at something the export does not know, e.g. a deleted endpoint.
    declared = deref(trigger) as WorkflowDefinitionInput['trigger'];
    if (holdsId(declared)) {
      unexpressed.push('name what its trigger points at, e.g. the incoming endpoint');
    }
  }

  return {
    input: {
      slug,
      ...(row.name === humanise(slug) ? {} : { name: row.name }),
      ...(row.description ? { description: row.description } : {}),
      ...(row.enabled ? { enabled: true } : {}),
      trigger: declared,
      steps,
    },
    warnings: unexpressed,
  };
}

/** The space's own workflows as `defineWorkflow` declarations, as keyed steps. */
export const workflowConfigExport: ResourceConfigExport<WorkflowRow> = {
  label: 'Workflows',
  description: 'As keyed steps; runs, versions and switched-off state stay behind.',
  icon: 'workflow',
  define: { name: 'defineWorkflow', from: '@manablox/plugin-workflows/define' },
  load: async ({ repos, spaceId }) =>
    runtimeOnly(await workflowRepos(repos).workflows.listBySpace(spaceId)).map((row) => ({
      id: row.id,
      label: row.name,
      slug: row.slug,
      row,
    })),
  render: (row, context) => workflowInput(row, context),
};
