import type { RunFailure } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { CredentialService } from '@manablox/services';
import type { AnyWorkflowAction } from '../../define/action.js';
import type {
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeKind,
  WorkflowNodeLog,
  WorkflowNodeOf,
  WorkflowRunContext,
  WorkflowRunState,
  WorkflowRunStatus,
} from '../../sdk.js';
import type { WorkflowRow, WorkflowRunRow } from '../db/index.js';
import type { WorkflowActionServices } from '../ports.js';
import type { WorkflowRegistry } from '../registry.js';

export type LogEntry = (
  status: WorkflowNodeLog['status'],
  /** A failure keeps its key for the admin to translate. */
  message: string | RunFailure | null,
  detail?: Record<string, unknown> | null,
  output?: unknown,
) => WorkflowNodeLog;

/** Result of running one node. */
export type NodeOutcome =
  /** Whatever it fired is on the ready queue. */
  | { kind: 'continued' }
  /** The run is saved and resumed later. */
  | { kind: 'paused' }
  /** Uncaught; the run fails. */
  | { kind: 'failed'; error: RunFailure }
  /** The run was aborted from outside. */
  | { kind: 'aborted' }
  /** A stop node ended the run; failed when it carries an error. */
  | { kind: 'finished'; error: RunFailure | null };

export type NodeHandler<K extends WorkflowNodeKind> = (
  node: WorkflowNodeOf<K>,
  entry: LogEntry,
) => Promise<NodeOutcome> | NodeOutcome;

export const CONTINUED: NodeOutcome = { kind: 'continued' };
export const PAUSED: NodeOutcome = { kind: 'paused' };
export const ABORTED: NodeOutcome = { kind: 'aborted' };

/** Least time between stored-abort checks inside a loop. */
export const ABORT_CHECK_MS = 1000;

/** How a walk stopped. */
export type WalkOutcome =
  | { kind: 'ended'; status: 'succeeded' | 'failed' | 'skipped'; error: RunFailure | null }
  /** Saved to resume later; nothing more is written. */
  | { kind: 'paused' }
  /** Stopped by an abort, which already moved the stored run. */
  | { kind: 'aborted' };

/** What a call node asks the engine for. */
export interface WorkflowCallRequest {
  workflowId: string;
  nodeKey: string;
  input: Record<string, unknown>;
  wait: boolean;
  /** The calling run's context, which the called run inherits its document and actor from. */
  context: WorkflowRunContext;
}

/** Where a called run stands. `output` is set once it has ended. */
export interface WorkflowCallResult {
  runId: string;
  workflowName: string;
  status: WorkflowRunStatus;
  output: unknown;
  error: string | null;
}

export interface WalkerEnvironment {
  services: WorkflowActionServices;
  /** The actions of every plugin. */
  registry: WorkflowRegistry;
  credentials: CredentialService | null;
  fetch: typeof fetch;
  adminUrl: string;
  now: () => Date;
  /** Whether the stored run was aborted, e.g. by another process; see `halted`. */
  isAborted?: (() => Promise<boolean>) | undefined;
  /** Least time between `isAborted` checks inside a loop; `ABORT_CHECK_MS` by default. */
  abortCheckMs?: number | undefined;
  /** Starts a called run, and runs it through when the caller waits. */
  call?: ((request: WorkflowCallRequest) => Promise<WorkflowCallResult>) | undefined;
  /** Where a called run stands now. */
  callResult?: ((runId: string) => Promise<WorkflowCallResult | null>) | undefined;
}

/** Saves the run to resume at `resumeAt`, or when its called run ends. */
export type PauseRun = (
  runId: string,
  state: WorkflowRunState,
  log: WorkflowNodeLog[],
  resumeAt: Date | null,
) => Promise<unknown>;

/** Run state while walking; stored as `WorkflowRunState` with arrays. */
export interface WalkState {
  outputs: WorkflowRunState['outputs'];
  fired: Set<string>;
  dead: Set<string>;
  ready: string[];
  done: Set<string>;
  awaiting?: { nodeId: string; runId: string } | null;
}

/** The walk as node handlers see it. */
export interface WalkerHost {
  readonly manablox: Manablox;
  readonly workflow: WorkflowRow;
  readonly run: WorkflowRunRow;
  readonly env: WalkerEnvironment;
  readonly graph: WorkflowGraph;
  readonly byId: ReadonlyMap<string, WorkflowNode>;
  readonly context: WorkflowRunContext;
  readonly log: WorkflowNodeLog[];
  /** Values scrubbed from the log. */
  readonly secrets: Set<string>;
  readonly signal: AbortSignal;
  readonly stopped: boolean;
  /** The run's state, or the current loop pass's state. */
  state: WalkState;
  /** Innermost loop pass, for the log; null outside a loop. */
  iteration: number | null;
  /** Actions that ran; zero means the run was skipped. */
  acted: number;
  fire(nodeId: string, port: string): void;
  killOutgoing(nodeId: string): void;
  record(node: WorkflowNode, action: AnyWorkflowAction | null, output: unknown): void;
  handleFailure(
    node: WorkflowNode,
    failure: RunFailure,
    detail?: Record<string, unknown> | null,
  ): NodeOutcome;
  whenStopped(entry: LogEntry): NodeOutcome | null;
  /** Saves the run as it stands. */
  pause(resumeAt: Date | null): Promise<void>;
  inputsOf(node: WorkflowNode): Record<string, unknown>;
  entryFor(node: WorkflowNode): LogEntry;
  halted(inLoop?: boolean): Promise<boolean>;
  runNode(node: WorkflowNode): Promise<NodeOutcome>;
}
