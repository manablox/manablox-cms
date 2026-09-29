/** The runtime half of workflow actions: what one gets when it runs, and what it returns. */

import type { CredentialSecret, ErrorDetail } from '@manablox/core';
import type { Logger, Manablox } from '@manablox/core/node';
import type { WorkflowActionMeta } from '../sdk/action.js';
import type { WorkflowRunContext } from '../sdk/run.js';
import type { WorkflowActionNode } from '../sdk/workflow.js';
import type { WorkflowActionServices } from '../server/ports.js';

export type { WorkflowActionServices };

export interface WorkflowActionContext<C = Record<string, unknown>> {
  config: C;
  node: WorkflowActionNode;
  run: WorkflowRunContext;
  /** Node key -> output of the nodes whose edges led here this run. Excludes the trigger. */
  inputs: Record<string, unknown>;
  /** `environmentId` is the space environment the workflow belongs to. */
  workflow: { id: string; name: string; spaceId: string; environmentId?: string };
  /** Renders a template against the run context. */
  render: (template: string) => string;
  /** Renders a JSON template, keeping the types of standalone placeholders. */
  renderJson: (template: string) => string;
  /** Reads one path out of the run context, un-stringified. */
  resolve: (path: string) => unknown;
  /** Guarded: private addresses are refused, size and redirects are capped. */
  fetch: typeof fetch;
  credential: CredentialSecret | null;
  /** Scrubs a string from this run's log. Credentials are scrubbed already. */
  secret: (value: string) => void;
  logger: Logger;
  manablox: Manablox;
  services: WorkflowActionServices;
  /** Aborts when the run's budget is spent; pass it to every request. */
  signal: AbortSignal;
  adminUrl: string;
}

export type WorkflowActionResult =
  | {
      kind: 'ok';
      /** One line for the run log. */
      message?: string | null;
      /** Facts for the log: an HTTP status, recipients, page count. */
      detail?: Record<string, unknown> | null;
      /** What later nodes read as `{{ nodes.<key>.… }}`. */
      output?: unknown;
      /** Leave by a port other than `ok`; must be one the action declares. */
      port?: string;
    }
  | { kind: 'stop'; message: string }
  | { kind: 'wait'; minutes: number };

export type WorkflowValidatePath = (...rest: Array<string | number>) => Array<string | number>;
export type WorkflowValidateAdd = (
  key: ErrorDetail['key'],
  path: Array<string | number>,
  params?: Record<string, unknown>,
) => void;

export interface WorkflowActionDefinition<C = Record<string, unknown>>
  extends Omit<WorkflowActionMeta, 'available' | 'unavailable' | 'defaults'> {
  /** Whether this instance can run it (mailer, AI provider, VAPID keys). */
  isAvailable?: (manablox: Manablox) => { ok: true } | { ok: false; reason: string };
  /** A fresh config for a new node. */
  defaults: () => C;
  /** Normalises the config on save, reporting every problem through `add` instead of throwing. */
  validate?: (config: C, at: WorkflowValidatePath, add: WorkflowValidateAdd) => C;
  execute: (ctx: WorkflowActionContext<C>) => Promise<WorkflowActionResult>;
}

// biome-ignore lint/suspicious/noExplicitAny: a registry holds actions of every config shape
export type AnyWorkflowAction = WorkflowActionDefinition<any>;

export function defineWorkflowAction<C extends Record<string, unknown>>(
  action: WorkflowActionDefinition<C>,
): WorkflowActionDefinition<C> {
  return action;
}
