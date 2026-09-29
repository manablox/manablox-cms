/** Run statuses, their transitions, logs, persisted state and the run context. */

import type { WorkflowNodeKind, WorkflowNodeOutput } from './workflow.js';

/** What a call from outside hands a run, such as an incoming webhook's request. */
export interface WorkflowTriggerPayload {
  /** The parsed body - an object when it was JSON, `{ raw: '…' }` when it was not. */
  body: unknown;
  /** The query string, as a flat map. */
  query: Record<string, string>;
  method: string;
}

export type WorkflowRunStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'aborted';

/** Statuses a run can still be aborted in. */
export const WORKFLOW_ACTIVE_RUN_STATUSES = ['queued', 'running', 'waiting'] as const;

export const isActiveRunStatus = (
  status: WorkflowRunStatus,
): status is (typeof WORKFLOW_ACTIVE_RUN_STATUSES)[number] =>
  (WORKFLOW_ACTIVE_RUN_STATUSES as readonly string[]).includes(status);

/** The statuses a run may move to from each; the repository guards its writes with it. */
export const WORKFLOW_RUN_TRANSITIONS: Readonly<
  Record<WorkflowRunStatus, readonly WorkflowRunStatus[]>
> = {
  queued: ['running', 'aborted'],
  running: ['waiting', 'succeeded', 'failed', 'skipped', 'aborted'],
  waiting: ['running', 'aborted'],
  succeeded: [],
  failed: [],
  skipped: [],
  aborted: [],
};

export const canMoveRun = (from: WorkflowRunStatus, to: WorkflowRunStatus): boolean =>
  WORKFLOW_RUN_TRANSITIONS[from].includes(to);

/** The statuses a run may reach `to` from. */
export const runStatusesInto = (to: WorkflowRunStatus): WorkflowRunStatus[] =>
  (Object.keys(WORKFLOW_RUN_TRANSITIONS) as WorkflowRunStatus[]).filter((from) =>
    canMoveRun(from, to),
  );

/** Statuses a run ends in. */
export type WorkflowRunEndStatus = 'succeeded' | 'failed' | 'skipped' | 'aborted';

/** One line of a run's log: what a node did. */
export interface WorkflowNodeLog {
  nodeId: string;
  key: string;
  kind: WorkflowNodeKind;
  /** The action's registry key, on an action node. */
  action: string | null;
  name: string;
  status: 'ok' | 'failed' | 'skipped' | 'stopped' | 'waiting';
  /** Which pass of a loop this ran in, from 0; absent outside a loop. */
  iteration?: number;
  message: string | null;
  /** The error key of a failure `message`, for the admin to translate; absent without one. */
  messageKey?: string;
  messageParams?: Record<string, unknown>;
  /** Node-specific facts worth keeping: the HTTP status, recipients, the resume time. */
  detail: Record<string, unknown> | null;
  /** What the node handed on, as `{{ nodes.<key> }}` read it; absent when nothing. */
  output?: unknown;
  /** `output` is JSON text, cut to `WORKFLOW_LOG_OUTPUT_LIMIT` characters. */
  outputTruncated?: boolean;
  startedAt: string;
  ms: number;
}

/** How much of a node's output, as JSON, a log line keeps. */
export const WORKFLOW_LOG_OUTPUT_LIMIT = 16_000;

/** Persisted run progress, so a run can resume. The context is rebuilt from `outputs`. */
export interface WorkflowRunState {
  /** Node key -> what it produced. */
  outputs: Record<string, WorkflowNodeOutput>;
  /** Edge ids that have fired, for `all` joins. */
  fired: string[];
  /** Edge ids that will never fire, so an `all` join stops waiting for them. */
  dead: string[];
  /** Node ids waiting to run, in order. */
  ready: string[];
  /** Node ids that have already run, so a diamond does not run a node twice. */
  done: string[];
  /** The call node waiting for its run to end, while the run is paused on it. */
  awaiting?: { nodeId: string; runId: string } | null;
  /** What a called run hands back, set when it ends. */
  result?: unknown;
}

export const emptyRunState = (): WorkflowRunState => ({
  outputs: {},
  fired: [],
  dead: [],
  ready: [],
  done: [],
});

/** Node key -> output value, as `{{ nodes.<key> }}` reads it. */
export const nodesOf = (
  state: Pick<WorkflowRunState, 'outputs'> | null | undefined,
): Record<string, unknown> =>
  Object.fromEntries(Object.entries(state?.outputs ?? {}).map(([key, out]) => [key, out.value]));

/** What the actor looked like at the moment the run started. */
export interface WorkflowActor {
  id: string;
  name: string;
  email: string;
}

/** What templates and conditions can read. */
export interface WorkflowRunContext {
  event: string;
  workflow: { id: string; name: string };
  space: { id: string; name: string; machineName: string; url: string };
  /** The staging environment the run belongs to; absent in production. */
  environment?: { id: string; machineName: string };
  /** What a call from outside handed over, e.g. an incoming webhook's; null otherwise. */
  payload: WorkflowTriggerPayload | null;
  /** The request headers of an incoming call, lower-cased, with the secret ones removed. */
  headers: Record<string, string> | null;
  content: Record<string, unknown> | null;
  /** The document before the save, on `content.updated`; lets `changed` rules work. */
  previous: Record<string, unknown> | null;
  documents: Record<string, unknown>[];
  actor: WorkflowActor | null;
  /** The admin URL of the document, when there is one. */
  url: string | null;
  at: string;
  /** Node key -> that node's output value. Empty until the first node has run. */
  nodes: Record<string, unknown>;
  /** The current item, inside a loop's branch; the innermost loop's, when they nest. */
  item?: unknown;
  /** Where the innermost loop stands, inside its branch. */
  loop?: WorkflowLoopPosition | null;
  /** What the calling workflow handed over, on a called run. */
  input?: Record<string, unknown> | null;
  /** The run that called this one. */
  caller?: WorkflowRunCaller | null;
  /** Facts a contributed trigger kind adds, e.g. the endpoint that was called (`webhook`). */
  [fact: string]: unknown;
}

export interface WorkflowRunCaller {
  workflowId: string;
  workflowName: string;
  runId: string;
  /** The call node's key. */
  nodeKey: string;
  /** Whether the caller waits for this run to end. */
  wait: boolean;
  /** Workflow ids from the outermost caller in, so a workflow cannot call itself round. */
  chain: string[];
}

export interface WorkflowLoopPosition {
  /** The loop node's key. */
  key: string;
  /** From 0. */
  index: number;
  /** How many passes there are; null while repeating until rules hold. */
  count: number | null;
}
