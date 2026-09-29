/** Abort triggers: what stops a workflow's active runs, and why a run was aborted. */

import { CONTENT_EVENT_LABELS, CONTENT_EVENTS } from '@manablox/core';
import type {
  WorkflowActor,
  WorkflowRunContext,
  WorkflowRunStatus,
  WorkflowTriggerPayload,
} from './run.js';
import type { WorkflowRuleSet } from './workflow.js';

/** What can stop a workflow's active runs: the content events, and more of the system. */
export const WORKFLOW_ABORT_EVENTS = [
  ...CONTENT_EVENTS,
  'asset.uploaded',
  'menu.saved',
  'menu.deleted',
  'member.granted',
  'workflow.finished',
] as const;
export type WorkflowAbortEvent = (typeof WORKFLOW_ABORT_EVENTS)[number];

export const WORKFLOW_ABORT_EVENT_LABELS: Record<
  WorkflowAbortEvent,
  { label: string; description: string }
> = {
  ...CONTENT_EVENT_LABELS,
  'asset.uploaded': { label: 'Asset uploaded', description: 'A file is uploaded.' },
  'menu.saved': { label: 'Menu saved', description: 'A menu or its items change.' },
  'menu.deleted': { label: 'Menu deleted', description: 'A menu is removed.' },
  'member.granted': {
    label: 'Member role granted',
    description: 'Someone gets a role in the space, or a different one.',
  },
  'workflow.finished': {
    label: 'Workflow finished',
    description: 'A run of any workflow ends. Filter on `data.workflowId` to pick one.',
  },
};

/**
 * Which active runs an abort stops. `document`: runs about the same document. `key`: runs
 * whose `runKey` renders to what `abortKey` renders to on the aborting call.
 */
export interface WorkflowAbortMatch {
  mode: 'all' | 'document' | 'key';
  /** Rendered against the run, outputs included: `{{ nodes.create_order.body.id }}`. */
  runKey: string;
  /** Rendered against the abort: `{{ payload.body.orderId }}`. */
  abortKey: string;
}

/** What every abort trigger has, whatever its kind. */
export interface WorkflowAbortTriggerBase {
  /** Stable, so a run can say which trigger stopped it. */
  id: string;
  /** Matched against the abort context, e.g. `data.workflowId` equals an id. */
  filter: WorkflowRuleSet | null;
  match: WorkflowAbortMatch;
}

/** Stops runs on a system event. Empty `typeIds` / `locales` mean every one; content events only. */
export interface WorkflowAbortEventTrigger extends WorkflowAbortTriggerBase {
  kind: 'event';
  events: WorkflowAbortEvent[];
  typeIds: string[];
  locales: string[];
}

/**
 * Abort trigger kinds by name; a plugin that contributes one to the `abortTriggers` extension
 * point adds its shape here, like `WorkflowTriggerKinds`.
 */
export interface WorkflowAbortTriggerKinds {
  event: WorkflowAbortEventTrigger;
}

export type WorkflowAbortTrigger = WorkflowAbortTriggerKinds[keyof WorkflowAbortTriggerKinds];

/** What an abort trigger's filter and `abortKey` read. */
export interface WorkflowAbortContext {
  event: string;
  space: WorkflowRunContext['space'];
  /** What a call from outside handed over, on a contributed kind's abort. */
  payload: WorkflowTriggerPayload | null;
  headers: Record<string, string> | null;
  /** The document, on content events. */
  content: Record<string, unknown> | null;
  previous: Record<string, unknown> | null;
  /** The event's own facts on the other events: the asset, menu, member or run. */
  data: Record<string, unknown> | null;
  actor: WorkflowActor | null;
  at: string;
  /** Facts a contributed abort kind adds, e.g. the endpoint that was called. */
  [fact: string]: unknown;
}

/** Why a run was aborted. */
export interface WorkflowRunAbort {
  /** `caller`: the run that called this one was aborted; a contributed kind's name otherwise. */
  source: 'event' | 'api' | 'caller' | (string & Record<never, never>);
  /** The abort trigger that fired; null from the API. */
  triggerId: string | null;
  /** The event name, what a contributed kind names (e.g. the webhook's slug), or null. */
  event: string | null;
  /** Who asked, from the API. */
  actor: string | null;
  reason: string | null;
  at: string;
  /** The status the run left; set when it is stored. */
  from?: WorkflowRunStatus | undefined;
}
