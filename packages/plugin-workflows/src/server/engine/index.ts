import {
  type ContentEvent,
  type ContentEventContext,
  type ContentRecord,
  type HookContextBase,
  RetryLater,
  type Scope,
} from '@manablox/core';
import { configuredSafeFetch, type Manablox } from '@manablox/core/node';
import type { Repositories } from '@manablox/db';
import type { CredentialService, Mailer, Pusher } from '@manablox/services';
import type { WorkflowTriggerOutcome, WorkflowTriggerStart } from '../../define/triggers.js';
import type {
  WorkflowAbortEvent,
  WorkflowNodeLog,
  WorkflowRunAbort,
  WorkflowRunState,
} from '../../sdk.js';
import type { ActiveWorkflowRun, WorkflowRow, WorkflowRunRow } from '../db/index.js';
import { workflowRepos } from '../db/index.js';
import { workflowKeys } from '../keys.js';
import type { WorkflowContentWrites, WorkflowLimits } from '../ports.js';
import { builtinRegistry, type WorkflowRegistry } from '../registry.js';
import { RunLifecycle, type WorkflowRef } from '../run-lifecycle.js';
import * as aborts from './abort.js';
import { resumeCaller } from './calls.js';
import type { EngineContext } from './context.js';
import * as lifecycle from './lifecycle.js';
import { LiveTriggerIndex } from './live-index.js';
import * as triggers from './triggers.js';

export { abortContext, runContext, serialise } from './context.js';
export { abortMatchesEvent, abortSelects, matchesEvent } from './matchers.js';
export type { WorkflowTestSample } from './triggers.js';

/** How long a run without a concurrency slot waits before it tries again. */
const RETRY_SLOT_MS = 5_000;

export interface WorkflowEngineOptions {
  mailer?: Mailer | null | undefined;
  pusher?: Pusher | null | undefined;
  /** Without it `content.*` actions fail. */
  content?: WorkflowContentWrites | null | undefined;
  /** Actions and trigger kinds of every plugin; the built-in ones alone by default. */
  registry?: WorkflowRegistry | undefined;
  /** How long runs may take and how much a crawl reads; see `WorkflowLimits`. */
  limits?: Partial<WorkflowLimits> | undefined;
  credentials?: CredentialService | undefined;
  /** The unguarded fetch the guard wraps. */
  fetch?: typeof fetch | undefined;
  /** For links in mails and notifications. */
  adminUrl?: string | undefined;
  /** Hands a queued run to a worker; defaults to running it in-process in the background. */
  dispatch?: ((runId: string) => Promise<void>) | undefined;
  /** Hands several over at once; defaults to `dispatch` for each. */
  dispatchMany?: ((runIds: readonly string[]) => Promise<void>) | undefined;
  /** Scheduler interval; 20 s catches every minute. */
  tickMs?: number | undefined;
  /** Least time between database abort checks inside a loop. */
  abortCheckMs?: number | undefined;
  now?: (() => Date) | undefined;
}

/**
 * Triggers runs from content events, the schedule, calls, manual starts and the kinds other
 * plugins contribute (`runTrigger`). Runs are persisted when queued and claimed by a worker
 * before executing.
 */
export class WorkflowEngine {
  private readonly ctx: EngineContext;
  private readonly tickMs: number;
  private readonly pending = new Set<Promise<void>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private stopped = false;
  private heard = false;

  constructor(
    private readonly manablox: Manablox,
    repos: Repositories,
    options: WorkflowEngineOptions = {},
  ) {
    const limits: WorkflowLimits = {
      runTimeoutSeconds: options.limits?.runTimeoutSeconds ?? 300,
      maxCrawlPages: options.limits?.maxCrawlPages ?? 50,
    };
    const ctx: EngineContext = {
      manablox,
      repos,
      services: {
        repos,
        mailer: options.mailer ?? null,
        pusher: options.pusher ?? null,
        content: options.content ?? null,
        limits,
      },
      registry: options.registry ?? builtinRegistry(),
      limits,
      credentials: options.credentials ?? null,
      safeFetch: configuredSafeFetch(
        manablox.config.net,
        options.fetch ? { fetch: options.fetch } : {},
      ),
      adminUrl: options.adminUrl ?? manablox.config.server.adminUrl,
      now: options.now ?? (() => new Date()),
      abortCheckMs: options.abortCheckMs,
      lifecycle: new RunLifecycle(manablox, repos, (run) => resumeCaller(ctx, run)),
      triggers: new LiveTriggerIndex(repos, manablox.config.cache.enabled),
      live: new Map(),
      calling: new Map(),
      dispatch: options.dispatch ?? ((runId) => this.background(runId, this.run(runId))),
      dispatchMany:
        options.dispatchMany ??
        (async (runIds) => {
          for (const runId of runIds) await ctx.dispatch(runId);
        }),
      run: (runId) => this.run(runId),
    };
    this.ctx = ctx;
    this.tickMs = options.tickMs ?? 20_000;

    const unsubscribe = workflowRepos(repos).workflows.onLiveChange((spaceId) =>
      this.forgetLive(spaceId),
    );
    manablox.onDispose(unsubscribe);
    manablox.onDispose(() => {
      this.stopped = true;
    });
  }

  get admin(): string {
    return this.ctx.adminUrl;
  }

  /** Whether content and abort events reach the engine; see `listen`. */
  get listening(): boolean {
    return this.heard;
  }

  /**
   * Lets the plugin's hooks hand events to the engine. Called at boot where runs are queued
   * (the plugin's `start`); other processes, such as `manablox sync`, start nothing.
   */
  listen(): void {
    this.heard = true;
  }

  /** Starts and aborts the workflows a content event matches. */
  contentEvent(
    event: ContentEvent,
    rows: readonly ContentRecord[],
    context: ContentEventContext,
  ): Promise<void> {
    return triggers.onContentEvent(this.ctx, event, rows, context);
  }

  /** Aborts the runs an event that can only abort matches. */
  abortEvent(
    event: WorkflowAbortEvent,
    scope: Scope,
    data: Record<string, unknown>,
    context: HookContextBase,
  ): Promise<void> {
    return triggers.onAbortEvent(this.ctx, event, scope, data, context);
  }

  /** Starts the clock for scheduled workflows and paused runs. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    this.timer.unref?.();
    this.manablox.onDispose(() => this.stop());
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.idle();
  }

  /** Resolves once every in-process run has finished. */
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  /** Drops a space's cached live triggers, or every space's without one. */
  forgetLive(spaceId?: string): void {
    this.ctx.triggers.forget(spaceId);
  }

  /**
   * Starts and aborts runs from a start of a trigger kind another plugin contributes, e.g. an
   * incoming webhook call: aborts first, so a start that does both replaces the old runs.
   */
  runTrigger(kind: string, start: WorkflowTriggerStart): Promise<WorkflowTriggerOutcome> {
    return triggers.runTrigger(this.ctx, kind, start);
  }

  /** The actions and trigger kinds the engine runs with. */
  get registry(): WorkflowRegistry {
    return this.ctx.registry;
  }

  /**
   * Starts workflows whose cron matches this minute and resumes due runs.
   * Multi-process safe via atomic claims.
   */
  async tick(now: Date = this.ctx.now()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await triggers.runSchedule(this.ctx, now);
    } catch (error) {
      this.manablox.logger.error({ err: error }, 'workflow tick failed');
    } finally {
      this.ticking = false;
    }
  }

  /** Starts a live workflow with a `manual` trigger for whoever is acting; returns the run id. */
  startManual(workflow: WorkflowRow, input: Record<string, unknown>): Promise<string> {
    return triggers.startManual(this.ctx, workflow, input);
  }

  /**
   * Runs the draft inline so the caller sees the log. A called or manual workflow gets
   * `input`, blanks by default; a contributed kind a stand-in start, see its `sample`.
   */
  testRun(
    workflow: WorkflowRow,
    sample: triggers.WorkflowTestSample = {},
  ): Promise<WorkflowRunRow> {
    return triggers.testRun(this.ctx, workflow, sample);
  }

  /** Aborts every active run of a workflow; returns their ids. */
  abortAll(workflow: WorkflowRef, abort: WorkflowRunAbort): Promise<string[]> {
    return aborts.abortAll(this.ctx, workflow, abort);
  }

  /** Aborts one run; false when it had already ended. A running walker stops before its next node. */
  abortRun(
    workflow: WorkflowRef,
    run: Pick<ActiveWorkflowRun, 'id' | 'trigger' | 'test' | 'context' | 'state'>,
    abort: WorkflowRunAbort,
  ): Promise<boolean> {
    return aborts.abortRun(this.ctx, workflow, run, abort);
  }

  /**
   * Worker entry point: executes a queued or paused run once it gets a slot under
   * `plugins.workflows.concurrency`; throws `RetryLater` while none is free.
   */
  async run(runId: string): Promise<void> {
    const run = await workflowRepos(this.ctx.repos).runs.findById(runId);
    if (!run) return;
    // A paused run stays paused while the plugin is off; the clock resumes it once it is on.
    if (
      run.status === 'waiting' &&
      !(await this.manablox.controls.feature(run.spaceId, workflowKeys.feature)).enabled
    ) {
      await workflowRepos(this.ctx.repos).runs.wakeAt(run.id, this.ctx.now());
      return;
    }
    const ttl = (this.ctx.limits.runTimeoutSeconds + 60) * 1000;
    const slot = await this.manablox.controls.acquire(
      run.spaceId,
      'plugins.workflows.concurrency',
      ttl,
    );
    if (!slot) throw new RetryLater(RETRY_SLOT_MS + Math.floor(Math.random() * 1000), 'no slot');
    try {
      await lifecycle.executeRun(this.ctx, runId);
    } finally {
      await slot.release();
    }
  }

  /** The workflow as this run walks it: the version it started on, or a test run's draft. */
  definitionFor(run: WorkflowRunRow): Promise<WorkflowRow | null> {
    return lifecycle.definitionFor(this.ctx, run);
  }

  /** Saves a paused run. Without `resumeAt` it waits for its called run to end. */
  pause(
    runId: string,
    state: WorkflowRunState,
    log: WorkflowNodeLog[],
    resumeAt: Date | null,
  ): Promise<void> {
    return lifecycle.pause(this.ctx, runId, state, log, resumeAt);
  }

  private background(runId: string, work: Promise<void>): Promise<void> {
    const tracked = work
      .catch((error) => {
        if (RetryLater.is(error)) {
          const retry = setTimeout(() => {
            if (!this.stopped) void this.ctx.dispatch(runId);
          }, error.delay);
          retry.unref?.();
          return;
        }
        this.manablox.logger.error({ err: error, runId }, 'workflow run crashed');
      })
      .finally(() => {
        this.pending.delete(tracked);
      });
    this.pending.add(tracked);
    // The caller does not wait for the run.
    return Promise.resolve();
  }
}
