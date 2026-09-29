import {
  CONTENT_EVENT_LABELS,
  CONTENT_EVENTS,
  CREDENTIAL_KIND_SPECS,
  CREDENTIAL_KINDS,
  type CredentialKind,
  type CredentialView,
  type Scope,
  scopeSpaceId,
} from '@manablox/core';
import {
  WORKFLOW_ABORT_EVENT_LABELS,
  WORKFLOW_ABORT_EVENTS,
  WORKFLOW_ACTION_GROUP_LABELS,
  WORKFLOW_CONDITION_OPERATOR_LABELS,
  WORKFLOW_CONDITION_OPERATORS,
  type WorkflowActionMeta,
  type WorkflowCallParameter,
} from '../../../sdk.js';
import { readWorkflowDesign, type WorkflowDesign } from '../../design.js';
import { composeWorkflowDesignPrompt, WORKFLOW_DESIGN_SYSTEM } from '../../design-prompt.js';
import type { WorkflowTriggerKindMeta } from '../../registry.js';
import { environmentOf, type SpaceLookups, spaceLookups, type WorkflowContext } from './context.js';

/** Everything the editor needs to draw the palette and node forms. */
export interface WorkflowCatalog {
  events: Array<{ id: string; label: string; description: string }>;
  /** What can abort a run: the events plus the rest of the system. */
  abortEvents: Array<{ id: string; label: string; description: string }>;
  /** Built-in and plugin actions with their forms. */
  actions: WorkflowActionMeta[];
  /** The palette's groups: the built-in ones, then those plugin actions name. */
  actionGroups: Array<{ id: string; label: string }>;
  /** Trigger kinds, the built-in ones first, then those other plugins contribute. */
  triggerKinds: WorkflowTriggerKindMeta[];
  /** Field kinds action forms may use beyond the built-in ones, drawn by their plugins. */
  fieldKinds: string[];
  operators: Array<{ id: string; label: string }>;
  /** Without secret material. */
  credentials: CredentialView[];
  /** Each trigger kind's catalogue entry, e.g. the endpoints a trigger may name, by kind. */
  triggers: Record<string, unknown>;
  /** Workflows a call node can run: those with a `call` trigger. */
  callable: Array<{
    id: string;
    name: string;
    enabled: boolean;
    parameters: WorkflowCallParameter[];
  }>;
  credentialKinds: Array<{
    id: CredentialKind;
    label: string;
    description: string;
    fields: (typeof CREDENTIAL_KIND_SPECS)[CredentialKind]['fields'];
  }>;
  /** Whether mail / push are configured. */
  mail: boolean;
  push: boolean;
  adminUrl: string;
}

/** Each trigger kind's catalogue entry for the environment, from what the lookups read. */
async function triggerEntries(
  ctx: WorkflowContext,
  lookups: SpaceLookups | null,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  if (!lookups) return out;
  for (const kind of ctx.registry.triggerKinds) {
    if (!kind.catalog) continue;
    out[kind.kind] = await kind.catalog({
      manablox: ctx.manablox,
      repos: ctx.repos,
      scope: lookups.scope,
      data: lookups.triggers.get(kind.kind),
      workflows: lookups.workflows,
    });
  }
  return out;
}

export async function catalogOf(
  ctx: WorkflowContext,
  lookups: SpaceLookups | null,
): Promise<WorkflowCatalog> {
  const { manablox, registry } = ctx;
  const mail = Boolean(manablox.config.mail.transport);
  const push = Boolean(manablox.config.push.vapidPublicKey && manablox.config.push.vapidPrivateKey);
  const actions = registry.actions.catalog(manablox);
  const groups = new Map<string, string>(Object.entries(WORKFLOW_ACTION_GROUP_LABELS));
  for (const action of actions) {
    if (!groups.has(action.group)) groups.set(action.group, action.groupLabel ?? action.group);
  }
  return {
    events: CONTENT_EVENTS.map((id) => ({ id, ...CONTENT_EVENT_LABELS[id] })),
    abortEvents: WORKFLOW_ABORT_EVENTS.map((id) => ({ id, ...WORKFLOW_ABORT_EVENT_LABELS[id] })),
    actions,
    actionGroups: [...groups].map(([id, label]) => ({ id, label })),
    triggerKinds: registry.triggerCatalog(),
    fieldKinds: registry.fieldKinds.map((entry) => entry.kind),
    operators: WORKFLOW_CONDITION_OPERATORS.map((id) => ({
      id,
      label: WORKFLOW_CONDITION_OPERATOR_LABELS[id],
    })),
    credentials: lookups && ctx.credentials ? ctx.credentials.views(lookups.credentials) : [],
    triggers: await triggerEntries(ctx, lookups),
    callable: (lookups?.workflows ?? []).flatMap((row) =>
      row.trigger.kind === 'call'
        ? [
            {
              id: row.id,
              name: row.name,
              enabled: row.enabled,
              parameters: row.trigger.parameters,
            },
          ]
        : [],
    ),
    credentialKinds: CREDENTIAL_KINDS.map((id) => ({
      id,
      ...CREDENTIAL_KIND_SPECS[id],
    })),
    mail,
    push,
    adminUrl: ctx.engine.admin,
  };
}

/** What `design` asks the model for. */
export interface WorkflowDesignInput {
  spaceId: string;
  /** The environment designed for, whose types and endpoints are used; production when absent. */
  scope?: Scope | null | undefined;
  prompt: string;
  providerKind?: string | undefined;
  model?: string | undefined;
  actorId?: string | null | undefined;
}

/**
 * Structured model answers retried with feedback until valid, as the AI plugin's `design`
 * service gives them. Refuses with that plugin's own error when `usable` says an answer holds
 * nothing.
 */
export interface WorkflowDesigner {
  design<T>(input: {
    spaceId: string;
    /** A hosted provider's kind, or `custom:<slug>` for a self-hosted one. */
    providerKind?: string | undefined;
    model?: string | undefined;
    prompt: string;
    system: string;
    /** Label shown in the generation history. */
    purpose: string;
    actorId?: string | null | undefined;
    check: (answer: Record<string, unknown>) => Promise<{ value: T; problems: string[] }>;
    usable?: ((value: T) => boolean) | undefined;
  }): Promise<{ value: T; problems: string[]; generationId: string }>;
}

/** Designs a workflow from a description, validated like a save and returned unsaved. */
export async function design(
  ctx: WorkflowContext,
  designer: WorkflowDesigner,
  input: WorkflowDesignInput,
): Promise<WorkflowDesign & { problems: string[]; generationId: string }> {
  const scope =
    input.scope && scopeSpaceId(input.scope) === input.spaceId ? input.scope : input.spaceId;
  const lookups = await spaceLookups(ctx, scope);
  const context = {
    catalog: await catalogOf(ctx, lookups),
    contentTypes: ctx.manablox.contentTypes.forSpace(lookups.scope),
    registry: ctx.registry,
  };
  const env = environmentOf(ctx, lookups);
  const result = await designer.design({
    spaceId: input.spaceId,
    providerKind: input.providerKind,
    model: input.model,
    prompt: composeWorkflowDesignPrompt(input.prompt, context),
    system: WORKFLOW_DESIGN_SYSTEM,
    purpose: 'Workflow',
    actorId: input.actorId,
    check: async (answer) => readWorkflowDesign(answer, context, env),
    usable: (value) => value.workflow.nodes.length > 0,
  });
  return { ...result.value, problems: result.problems, generationId: result.generationId };
}
