import { ManabloxError, type RunFailure, runFailure } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { AnyWorkflowAction } from '../../define/action.js';
import {
  nodesOf,
  WORKFLOW_NODE_SPECS,
  WORKFLOW_TRIGGER_ID,
  type WorkflowConditionNode,
  type WorkflowDelayNode,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNodeKind,
  type WorkflowNodeLog,
  type WorkflowRunContext,
  type WorkflowRunState,
  workflowNodeAction,
  workflowNodeLabel,
} from '../../sdk.js';
import { evaluateCondition } from '../conditions.js';
import type { WorkflowRow, WorkflowRunRow } from '../db/index.js';
import { logOutput, scrubDetail, scrubText } from '../run-log.js';
import { runAction } from './action.js';
import { runCall, settleCall } from './call.js';
import { runStop, runSwitch } from './control.js';
import { runLoop } from './loop.js';
import {
  ABORT_CHECK_MS,
  ABORTED,
  CONTINUED,
  type LogEntry,
  type NodeHandler,
  type NodeOutcome,
  PAUSED,
  type PauseRun,
  type WalkerEnvironment,
  type WalkerHost,
  type WalkOutcome,
  type WalkState,
} from './types.js';

const WALK_PAUSED: WalkOutcome = { kind: 'paused' };
const WALK_ABORTED: WalkOutcome = { kind: 'aborted' };

/** Interprets one run over one graph; outputs land under `nodes.<key>`. */
export class Walk implements WalkerHost {
  state: WalkState;
  readonly log: WorkflowNodeLog[];
  readonly graph: WorkflowGraph;
  readonly context: WorkflowRunContext;
  readonly byId = new Map<string, WorkflowNode>();
  /** Node id -> its edges, in graph order. */
  private readonly outgoing = new Map<string, WorkflowEdge[]>();
  private readonly incoming = new Map<string, WorkflowEdge[]>();
  readonly secrets = new Set<string>();
  private readonly abort = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  acted = 0;
  iteration: number | null = null;
  stopped = false;
  /** When `isAborted` was last asked. */
  private checkedAt = Number.NEGATIVE_INFINITY;
  /** How each kind of node runs. */
  private readonly handlers: { [K in WorkflowNodeKind]: NodeHandler<K> } = {
    action: (node, entry) => runAction(this, node, entry),
    condition: (node, entry) => this.runCondition(node, entry),
    switch: (node, entry) => runSwitch(this, node, entry),
    delay: (node, entry) => this.runDelay(node, entry),
    loop: (node, entry) => runLoop(this, node, entry),
    call: (node, entry) => runCall(this, node, entry),
    stop: (node, entry) => runStop(this, node, entry),
  };

  constructor(
    private readonly pauseRun: PauseRun,
    readonly manablox: Manablox,
    readonly workflow: WorkflowRow,
    readonly run: WorkflowRunRow,
    readonly env: WalkerEnvironment,
  ) {
    this.graph = { nodes: workflow.nodes, edges: workflow.edges };
    this.state = normaliseState(run.state);
    this.log = [...run.log];
    for (const node of workflow.nodes) this.byId.set(node.id, node);
    for (const edge of workflow.edges) {
      pushTo(this.outgoing, edge.from, edge);
      pushTo(this.incoming, edge.to, edge);
    }
    // Rebuild template context from stored outputs on resume.
    this.context = { ...run.context, nodes: nodesOf(this.state) };
    this.timer = setTimeout(
      () => this.abort.abort(new ManabloxError('plugins.workflows.run.timeout')),
      env.services.limits.runTimeoutSeconds * 1000,
    );
    this.timer.unref?.();
  }

  get signal(): AbortSignal {
    return this.abort.signal;
  }

  /** The run's state as stored. */
  storedState(): WorkflowRunState {
    return toStored(this.state);
  }

  /** Aborts the run: in-flight requests are cancelled and no further node starts. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.abort.abort(new ManabloxError('plugins.workflows.run.aborted'));
  }

  async walk(): Promise<WalkOutcome> {
    try {
      if (this.isFresh()) this.fire(WORKFLOW_TRIGGER_ID, 'out');

      if (this.state.awaiting) {
        if (await this.halted()) return WALK_ABORTED;
        const stop = this.walkStop(await settleCall(this));
        if (stop) return stop;
      }

      while (this.state.ready.length) {
        const id = this.state.ready.shift() as string;
        if (this.state.done.has(id)) continue;
        const node = this.byId.get(id);
        if (!node) continue;
        if (await this.halted()) return WALK_ABORTED;
        this.state.done.add(id);

        const stop = this.walkStop(await this.runNode(node));
        if (stop) return stop;
      }

      return { kind: 'ended', status: this.acted > 0 ? 'succeeded' : 'skipped', error: null };
    } finally {
      clearTimeout(this.timer);
    }
  }

  /**
   * Whether to stop before the next node. An abort in this process stops at once; one
   * stored by another is checked before every top-level node, and in loops at most every
   * `abortCheckMs`.
   */
  async halted(inLoop = false): Promise<boolean> {
    if (this.stopped || !this.env.isAborted) return this.stopped;
    const now = Date.now();
    if (inLoop && now - this.checkedAt < (this.env.abortCheckMs ?? ABORT_CHECK_MS)) return false;
    this.checkedAt = now;
    if (await this.env.isAborted()) this.stop();
    return this.stopped;
  }

  /** The walk's end for a node outcome that stops it; null to go on. */
  private walkStop(outcome: NodeOutcome): WalkOutcome | null {
    if (outcome.kind === 'aborted') return WALK_ABORTED;
    if (outcome.kind === 'paused') return WALK_PAUSED;
    if (outcome.kind === 'failed') return { kind: 'ended', status: 'failed', error: outcome.error };
    if (outcome.kind === 'finished') {
      if (outcome.error) return { kind: 'ended', status: 'failed', error: outcome.error };
      return { kind: 'ended', status: this.acted > 0 ? 'succeeded' : 'skipped', error: null };
    }
    return null;
  }

  private isFresh(): boolean {
    return (
      this.state.done.size === 0 && this.state.ready.length === 0 && this.state.fired.size === 0
    );
  }

  /** Log lines for a node, timed from now. */
  entryFor(node: WorkflowNode): LogEntry {
    const startedAt = this.env.now();
    return (status, message, detail = null, output = undefined) => {
      const failure = message !== null && typeof message === 'object' ? message : null;
      const text = failure ? failure.message : (message as string | null);
      return {
        nodeId: node.id,
        key: node.key,
        kind: node.kind,
        action: workflowNodeAction(node),
        name: node.name || this.labelOf(node),
        status,
        ...(this.iteration === null ? {} : { iteration: this.iteration }),
        message: scrubText(this.secrets, text),
        ...(failure?.key ? { messageKey: failure.key } : {}),
        ...(failure?.params
          ? { messageParams: scrubDetail(this.secrets, failure.params) ?? {} }
          : {}),
        detail: scrubDetail(this.secrets, detail),
        ...logOutput(this.secrets, output),
        startedAt: startedAt.toISOString(),
        ms: this.env.now().getTime() - startedAt.getTime(),
      };
    };
  }

  async runNode(node: WorkflowNode): Promise<NodeOutcome> {
    const entry = this.entryFor(node);

    if (!node.enabled) {
      this.log.push(entry('skipped', 'Node is switched off'));
      this.fire(node.id, WORKFLOW_NODE_SPECS[node.kind].defaultPort);
      return CONTINUED;
    }

    const handler = this.handlers[node.kind] as NodeHandler<WorkflowNodeKind>;
    return handler(node, entry);
  }

  private runCondition(node: WorkflowConditionNode, entry: LogEntry): NodeOutcome {
    const holds = evaluateCondition(node, this.context);
    this.log.push(
      entry(
        'ok',
        holds ? 'Rules hold - taking the yes side' : 'Rules do not hold - taking the no side',
        { side: holds ? 'true' : 'false' },
      ),
    );
    this.fire(node.id, holds ? 'true' : 'false');
    return CONTINUED;
  }

  private async runDelay(node: WorkflowDelayNode, entry: LogEntry): Promise<NodeOutcome> {
    // Resume uses the run's state, which a loop pass is not.
    if (this.iteration !== null) {
      const failure = runFailure(
        'plugins.workflows.run.delayInLoop',
        {},
        'A wait cannot run inside a loop',
      );
      this.log.push(entry('failed', failure));
      return this.handleFailure(node, failure);
    }
    const resumeAt = new Date(this.env.now().getTime() + node.minutes * 60_000);
    this.log.push(
      entry('waiting', `Waiting until ${resumeAt.toISOString()}`, {
        resumeAt: resumeAt.toISOString(),
      }),
    );
    // Queue successors before pausing so the resumed run walks on.
    this.fire(node.id, 'out');
    await this.pause(resumeAt);
    return PAUSED;
  }

  async pause(resumeAt: Date | null): Promise<void> {
    await this.pauseRun(this.run.id, toStored(this.state), this.log, resumeAt);
  }

  /** The aborted outcome, logged, once the run was stopped; null while it runs on. */
  whenStopped(entry: LogEntry): NodeOutcome | null {
    if (!this.stopped) return null;
    this.log.push(entry('stopped', 'Aborted while running'));
    return ABORTED;
  }

  /** An `error` edge catches it, `continueOnError` walks on, otherwise the run fails. */
  handleFailure(
    node: WorkflowNode,
    failure: RunFailure,
    detail: Record<string, unknown> | null = null,
  ): NodeOutcome {
    const caught = this.outgoing.get(node.id)?.some((edge) => edge.fromPort === 'error');
    if (caught) {
      this.record(node, null, { message: failure.message, detail });
      this.fire(node.id, 'error');
      return CONTINUED;
    }
    if (node.continueOnError) {
      this.fire(node.id, WORKFLOW_NODE_SPECS[node.kind].defaultPort);
      return CONTINUED;
    }
    this.killOutgoing(node.id);
    this.state.ready.length = 0;
    return { kind: 'failed', error: failure };
  }

  /** Stores a node's output for templates and resumed runs. */
  record(node: WorkflowNode, action: AnyWorkflowAction | null, output: unknown): void {
    if (output === undefined) return;
    this.state.outputs[node.key] = { type: action?.output.type ?? 'json', value: output };
    this.context.nodes[node.key] = output;
  }

  /** Fires edges leaving `port` whose guard holds; marks the rest dead for `all` joins. */
  fire(nodeId: string, port: string): void {
    const touched = new Set<string>();
    for (const edge of this.outgoing.get(nodeId) ?? []) {
      const alive =
        edge.fromPort === port && (!edge.guard || evaluateCondition(edge.guard, this.context));
      (alive ? this.state.fired : this.state.dead).add(edge.id);
      touched.add(edge.to);
    }
    for (const target of touched) this.consider(target);
  }

  /** Ends this branch. */
  killOutgoing(nodeId: string): void {
    const touched = new Set<string>();
    for (const edge of this.outgoing.get(nodeId) ?? []) {
      this.state.dead.add(edge.id);
      touched.add(edge.to);
    }
    for (const target of touched) this.consider(target);
  }

  private consider(nodeId: string): void {
    if (this.state.done.has(nodeId) || this.state.ready.includes(nodeId)) return;
    const node = this.byId.get(nodeId);
    if (!node) return;

    const incoming = this.incoming.get(nodeId) ?? [];
    if (!incoming.some((edge) => this.state.fired.has(edge.id))) return;
    if (node.join === 'all' && !incoming.every((edge) => this.settled(edge))) return;
    this.state.ready.push(nodeId);
  }

  private settled(edge: WorkflowEdge): boolean {
    return this.state.fired.has(edge.id) || this.state.dead.has(edge.id);
  }

  /** Outputs of the source nodes of fired incoming edges. */
  inputsOf(node: WorkflowNode): Record<string, unknown> {
    const inputs: Record<string, unknown> = {};
    for (const edge of this.incoming.get(node.id) ?? []) {
      if (!this.state.fired.has(edge.id)) continue;
      const from = this.byId.get(edge.from);
      // A loop's `each` edge carries the item.
      if (from?.kind === 'loop' && edge.fromPort === 'each') inputs[from.key] = this.context.item;
      else if (from && from.key in this.context.nodes) {
        inputs[from.key] = this.context.nodes[from.key];
      }
    }
    return inputs;
  }

  private labelOf(node: WorkflowNode): string {
    const type = workflowNodeAction(node);
    return workflowNodeLabel(node, type ? this.env.registry.actions.tryGet(type) : null);
  }
}

function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Reads a missing or partial run state safely. */
function normaliseState(state: WorkflowRunState | null | undefined): WalkState {
  return {
    outputs: state?.outputs ?? {},
    fired: new Set(state?.fired),
    dead: new Set(state?.dead),
    ready: [...(state?.ready ?? [])],
    done: new Set(state?.done),
    ...(state?.awaiting ? { awaiting: state.awaiting } : {}),
  };
}

function toStored(state: WalkState): WorkflowRunState {
  return {
    outputs: state.outputs,
    fired: [...state.fired],
    dead: [...state.dead],
    ready: [...state.ready],
    done: [...state.done],
    ...(state.awaiting !== undefined ? { awaiting: state.awaiting } : {}),
  };
}
