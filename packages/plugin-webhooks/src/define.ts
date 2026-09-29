/**
 * `@manablox/plugin-webhooks/define`: code-declared webhooks, normalised with the admin form's
 * checks, and the webhook trigger of code workflows. Safe to load at config time.
 */

import {
  humanise,
  isMachineName,
  ManabloxError,
  ref,
  SIGNATURE_HEADER,
  type SignatureAlgorithm,
  type SignatureFormat,
  type SpaceTarget,
} from '@manablox/core';
import type {
  CodeWorkflowAbortMatch,
  WorkflowAbortTriggerBase,
  WorkflowRuleSet,
} from '@manablox/plugin-workflows/define';
import {
  WEBHOOK_AUTH_CREDENTIAL_KIND,
  WEBHOOK_AUTH_MODES_BY_DIRECTION,
  type WebhookAuth,
  type WebhookAuthMode,
  type WebhookDirection,
  type WebhookMethod,
} from './sdk.js';

/** The resource kind code webhooks are declared under, `resources.plugins[...]`. */
export const WEBHOOK_RESOURCE_KIND = 'webhooks.webhook';

/** Starts a workflow when an incoming webhook of the same environment is called. */
export interface WebhookTrigger {
  kind: 'webhook';
  /** An incoming webhook of the same space. */
  webhookId: string | null;
  /** Matches against the call, e.g. `{{ payload.body.action }}` equals `opened`. */
  filter: WorkflowRuleSet | null;
}

/** Stops a workflow's active runs when an incoming webhook is called. */
export interface WebhookAbortTrigger extends WorkflowAbortTriggerBase {
  kind: 'webhook';
  webhookId: string | null;
}

declare module '@manablox/plugin-workflows/define' {
  interface WorkflowTriggerKinds {
    webhook: WebhookTrigger;
  }
  interface WorkflowAbortTriggerKinds {
    webhook: WebhookAbortTrigger;
  }
}

/** A code workflow's trigger on the incoming endpoint declared with `defineWebhook`. */
export function webhookTrigger(
  slug: string,
  options: { filter?: WorkflowRuleSet | null | undefined } = {},
): WebhookTrigger {
  return {
    kind: 'webhook',
    webhookId: ref.of(WEBHOOK_RESOURCE_KIND, slug),
    filter: options.filter ?? null,
  };
}

/** A code workflow's abort trigger on the incoming endpoint declared with `defineWebhook`. */
export function webhookAbort(
  slug: string,
  options: {
    filter?: WorkflowRuleSet | null | undefined;
    match?: CodeWorkflowAbortMatch | undefined;
  } = {},
) {
  return { kind: 'webhook' as const, webhookId: ref.of(WEBHOOK_RESOURCE_KIND, slug), ...options };
}

export interface CodeWebhookAuth {
  mode: WebhookAuthMode;
  /** The slug of a credential declared with `defineCredential`. */
  credential?: string | undefined;
  signatureHeader?: string | undefined;
  algorithm?: SignatureAlgorithm | undefined;
  format?: SignatureFormat | undefined;
}

export interface WebhookDefinitionInput {
  slug: string;
  direction: WebhookDirection;
  name?: string | undefined;
  description?: string | undefined;
  spaces?: SpaceTarget | undefined;
  /** Only read when the row is created. */
  enabled?: boolean | undefined;
  /** Outgoing: where the call goes. */
  url?: string | undefined;
  /** Outgoing: the content events sent. Empty means all. */
  events?: string[] | undefined;
  headers?: Array<{ name: string; value: string }> | undefined;
  /** Incoming: the methods accepted. Defaults to `POST`. */
  methods?: WebhookMethod[] | undefined;
  auth?: CodeWebhookAuth | undefined;
}

export interface WebhookDefinition {
  kind: 'webhook';
  slug: string;
  direction: WebhookDirection;
  name: string;
  description: string | null;
  spaces: SpaceTarget;
  enabled: boolean;
  url: string;
  events: string[];
  headers: Array<{ name: string; value: string }>;
  methods: WebhookMethod[];
  /** `credentialId` holds a `ref.credential(...)` until the reconciler resolves it. */
  auth: WebhookAuth;
  sourceRef?: string;
}

export function defineWebhook(input: WebhookDefinitionInput): WebhookDefinition {
  if (!isMachineName(input.slug)) {
    throw ManabloxError.badRequest('codeResource.slug.invalid', {
      kind: WEBHOOK_RESOURCE_KIND,
      slug: input.slug,
    });
  }

  const mode = input.auth?.mode ?? 'none';
  if (!WEBHOOK_AUTH_MODES_BY_DIRECTION[input.direction].includes(mode)) {
    throw ManabloxError.badRequest('plugins.webhooks.code.auth.modeUnsupported', {
      slug: input.slug,
      direction: input.direction,
      mode,
    });
  }
  if (mode !== 'none' && !input.auth?.credential) {
    throw ManabloxError.badRequest('plugins.webhooks.code.auth.credentialRequired', {
      slug: input.slug,
      mode,
      kind: WEBHOOK_AUTH_CREDENTIAL_KIND[mode],
    });
  }
  if (input.direction === 'outgoing' && !input.url) {
    throw ManabloxError.badRequest('plugins.webhooks.code.url.required', { slug: input.slug });
  }

  return {
    kind: 'webhook',
    slug: input.slug,
    direction: input.direction,
    name: input.name ?? humanise(input.slug),
    description: input.description ?? null,
    spaces: input.spaces ?? '*',
    enabled: input.enabled ?? true,
    url: input.direction === 'outgoing' ? (input.url as string) : '',
    events: input.direction === 'outgoing' ? (input.events ?? []) : [],
    headers: input.direction === 'outgoing' ? (input.headers ?? []) : [],
    methods: input.direction === 'incoming' ? (input.methods ?? ['POST']) : [],
    auth: {
      mode,
      credentialId: input.auth?.credential ? ref.credential(input.auth.credential) : null,
      signatureHeader: input.auth?.signatureHeader ?? SIGNATURE_HEADER,
      algorithm: input.auth?.algorithm ?? 'sha256',
      format: input.auth?.format ?? 'prefixed',
    },
  };
}
