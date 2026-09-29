import {
  type ContentEvent,
  type ContentEventContext,
  type ContentRecord,
  contentEventHooks,
  type HookContextBase,
  onHook,
  type PluginContext,
  type PluginHookRegistration,
  type Scope,
  scopeOf,
} from '@manablox/core';
import { currentActor } from '@manablox/core/node';
import type { ContentRow } from '@manablox/db';
import type { WorkflowTriggerOutcome, WorkflowTriggerStart } from '../../define/triggers.js';
import type {
  WorkflowAbortEvent,
  WorkflowAbortTrigger,
  WorkflowActor,
  WorkflowRuleSet,
  WorkflowRunContext,
  WorkflowTriggerPayload,
} from '../../sdk.js';
import { evaluateCondition } from '../conditions.js';
import { cronMatches, floorToMinute, parseCron } from '../cron.js';
import type { LiveWorkflow, WorkflowRow, WorkflowRunRow } from '../db/index.js';
import { workflowRepos } from '../db/index.js';
import { workflowKeys } from '../keys.js';
import type {} from '../services/index.js';
import { snapshotOf } from '../versions.js';
import { abortByTriggers } from './abort.js';
import {
  abortContext,
  actorInfo,
  documentUrl,
  type EngineContext,
  environmentInfo,
  runContext,
  serialise,
  spaceInfo,
} from './context.js';
import { beforeRun, enqueue, enqueueManyUnlessRefused, enqueueUnlessRefused } from './lifecycle.js';
import { abortMatchesEvent, matchesEvent } from './matchers.js';

/** What a test run starts from, in place of a real event. */
export interface WorkflowTestSample {
  document?: ContentRow | null | undefined;
  /** A called workflow's parameters. */
  input?: Record<string, unknown> | null | undefined;
  /** A call from outside, for a kind a plugin contributes, e.g. an incoming webhook's. */
  payload?: WorkflowTriggerPayload | null | undefined;
  headers?: Record<string, string> | null | undefined;
}

/** The environment a hook ran in; the space's production environment when it names none. */
const hookScope = (spaceId: string, context: HookContextBase): Scope =>
  context.environmentId ? { spaceId, environmentId: context.environmentId } : spaceId;

/**
 * The plugin's `hooks`: content events start and stop workflows, the other events only stop
 * them. They act once the engine listens, on management instances (see the plugin's `start`).
 */
export function workflowHooks(plugin: PluginContext): PluginHookRegistration[] {
  const listening = () => {
    const engine = plugin.plugins.get('workflows')?.engine;
    return engine?.listening ? engine : null;
  };
  const abortOn = async (
    event: WorkflowAbortEvent,
    spaceId: string | null | undefined,
    data: () => object | Promise<object>,
    context: HookContextBase,
  ) => {
    const engine = listening();
    if (!engine || !spaceId) return;
    await engine.abortEvent(event, hookScope(spaceId, context), { ...(await data()) }, context);
  };
  return [
    ...contentEventHooks(async (event, rows, context) => {
      await listening()?.contentEvent(event, rows, context);
    }),
    onHook('asset:afterUpload', (payload, context) =>
      abortOn(
        'asset.uploaded',
        context.spaceId,
        async () => (await plugin.repos.assets.findById(payload.id)) ?? payload,
        context,
      ),
    ),
    onHook('menu:afterWrite', (payload, context) =>
      abortOn('menu.saved', payload.spaceId, () => payload, context),
    ),
    onHook('menu:afterDelete', (payload, context) =>
      abortOn('menu.deleted', payload.spaceId, () => payload, context),
    ),
    onHook('member:afterGrant', (payload, context) =>
      abortOn('member.granted', payload.spaceId, () => payload, context),
    ),
    onHook('workflows:afterRun', (payload, context) =>
      abortOn('workflow.finished', payload.spaceId, () => payload, context),
    ),
  ];
}

/** Starts and aborts the workflows a content event matches. */
export async function onContentEvent(
  ctx: EngineContext,
  event: ContentEvent,
  rows: readonly ContentRecord[],
  context: ContentEventContext,
): Promise<void> {
  const { spaceId } = context;
  // The rows' environment runs its own workflows.
  const candidates = await ctx.triggers.liveIn(context.scope);
  if (candidates.length === 0) return;
  let shared: {
    space: WorkflowRunContext['space'];
    actor: WorkflowActor | null;
    environment: Pick<WorkflowRunContext, 'environment'>;
  } | null = null;
  const previous =
    event === 'content.updated' && context.previous ? serialise(context.previous) : null;

  for (const row of rows) {
    const matching = candidates.filter((workflow) => matchesEvent(workflow.trigger, event, row));
    const aborting = candidates.filter((workflow) =>
      workflow.abortTriggers.some((trigger) => abortMatchesEvent(trigger, event, row)),
    );
    if (matching.length === 0 && aborting.length === 0) continue;
    // Serialised once for every run and abort of the row.
    const content = serialise(row);

    shared ??= {
      space: await spaceInfo(ctx, spaceId),
      actor: await actorInfo(ctx, context.actor?.userId ?? null),
      environment: await environmentInfo(ctx, row),
    };
    const { space, actor, environment } = shared;

    // Before starting, so an event that both aborts and starts replaces the old runs.
    if (aborting.length) {
      const context = abortContext(
        { event, space, at: ctx.now().toISOString() },
        { content, previous, actor },
      );
      for (const workflow of aborting) {
        const triggers = workflow.abortTriggers.filter((trigger) =>
          abortMatchesEvent(trigger, event, row),
        );
        await abortByTriggers(ctx, workflow, triggers, context, 'event', event);
      }
    }

    const url =
      event === 'content.deleted' ? null : documentUrl(ctx, row.id, environment.environment);
    // The row's runs are persisted and queued together.
    await enqueueManyUnlessRefused(
      ctx,
      matching.map((workflow) => ({
        workflow,
        trigger: event,
        context: runContext(
          {
            event,
            workflow: { id: workflow.id, name: workflow.name },
            space,
            at: ctx.now().toISOString(),
          },
          { ...environment, content, previous, actor, url },
        ),
      })),
    );
  }
}

/** Aborts the runs an event that can only abort matches. */
export async function onAbortEvent(
  ctx: EngineContext,
  event: WorkflowAbortEvent,
  scope: Scope,
  data: Record<string, unknown>,
  context: HookContextBase,
): Promise<void> {
  const spaceId = typeof scope === 'string' ? scope : scope.spaceId;
  const aborting = (await ctx.triggers.liveIn(scope)).filter((workflow) =>
    workflow.abortTriggers.some((trigger) => abortMatchesEvent(trigger, event, null)),
  );
  if (aborting.length === 0) return;
  const abort = abortContext(
    { event, space: await spaceInfo(ctx, spaceId), at: ctx.now().toISOString() },
    {
      data: JSON.parse(JSON.stringify(data)) as Record<string, unknown>,
      actor: await actorInfo(ctx, context.actor?.userId ?? null),
    },
  );
  for (const workflow of aborting) {
    const triggers = workflow.abortTriggers.filter((trigger) =>
      abortMatchesEvent(trigger, event, null),
    );
    await abortByTriggers(ctx, workflow, triggers, abort, 'event', event);
  }
}

/**
 * A start of a contributed kind: aborts the runs of every live workflow with an abort trigger
 * the start concerns, then starts every live workflow whose trigger it concerns and whose
 * filter matches; both in the source's environment.
 */
export async function runTrigger(
  ctx: EngineContext,
  kind: string,
  start: WorkflowTriggerStart,
): Promise<WorkflowTriggerOutcome> {
  const { source } = start;
  const event = start.event ?? kind;
  const label = start.label ?? source.id;
  const live = await ctx.triggers.liveIn(scopeOf(source));
  const space = await spaceInfo(ctx, source.spaceId);

  const abortKind = ctx.registry.abortTrigger(kind);
  const concerns = (trigger: WorkflowAbortTrigger) =>
    trigger.kind === kind && (abortKind?.matches?.(trigger, source.id) ?? false);
  const aborting = abortKind
    ? live.filter((workflow) => workflow.abortTriggers.some(concerns))
    : [];
  const abortedRunIds: string[] = [];
  if (aborting.length) {
    const context = abortContext(
      { event, space, at: ctx.now().toISOString() },
      { ...start.context },
    );
    for (const workflow of aborting) {
      const triggers = workflow.abortTriggers.filter(concerns);
      abortedRunIds.push(...(await abortByTriggers(ctx, workflow, triggers, context, kind, label)));
    }
  }

  const triggerKind = ctx.registry.trigger(kind);
  const candidates = triggerKind?.matches
    ? live.filter(
        (workflow) =>
          workflow.trigger.kind === kind && triggerKind.matches?.(workflow.trigger, source.id),
      )
    : [];
  const runIds: string[] = [];
  if (candidates.length) {
    const environment = await environmentInfo(ctx, source);
    for (const workflow of candidates) {
      const context = runContext(
        {
          event,
          workflow: { id: workflow.id, name: workflow.name },
          space,
          at: ctx.now().toISOString(),
        },
        { ...environment, ...start.context },
      );
      const filter = (workflow.trigger as { filter?: WorkflowRuleSet | null }).filter ?? null;
      if (filter && !evaluateCondition(filter, context)) continue;
      const runId = await enqueueUnlessRefused(ctx, workflow, event, context);
      if (runId) runIds.push(runId);
    }
  }
  return { runIds, abortedRunIds };
}

/** Starts workflows whose cron matches this minute and dispatches due runs. */
export async function runSchedule(ctx: EngineContext, now: Date): Promise<void> {
  const minute = floorToMinute(now);
  const scheduled = await workflowRepos(ctx.repos).workflows.listLive({
    kinds: ['schedule'],
    environments: 'all',
  });
  for (const workflow of scheduled) {
    if (workflow.trigger.kind !== 'schedule') continue;
    const spec = parseCron(workflow.trigger.cron);
    if (!spec || !cronMatches(spec, minute, workflow.trigger.timezone)) continue;
    if (!(await workflowRepos(ctx.repos).workflows.claimSchedule(workflow.id, minute))) continue;
    await startScheduled(ctx, workflow);
  }

  await resumeDue(ctx, now);
}

/** Dispatches due runs; runs of spaces with `workflows` off stay paused and are skipped. */
async function resumeDue(ctx: EngineContext, now: Date): Promise<void> {
  const off: string[] = [];
  const checked = new Set<string>();
  for (;;) {
    const due = await workflowRepos(ctx.repos).runs.listDue(now, off);
    let skipped = false;
    for (const { spaceId } of due) {
      if (checked.has(spaceId)) continue;
      checked.add(spaceId);
      if (!(await ctx.manablox.controls.feature(spaceId, workflowKeys.feature)).enabled) {
        off.push(spaceId);
        skipped = true;
      }
    }
    // Refilled without them, so they cannot crowd out other spaces' runs.
    if (skipped) continue;
    for (const run of due) await ctx.dispatch(run.id);
    return;
  }
}

async function startScheduled(ctx: EngineContext, workflow: LiveWorkflow): Promise<void> {
  if (workflow.trigger.kind !== 'schedule') return;
  const space = await spaceInfo(ctx, workflow.spaceId);
  const selection = workflow.trigger.selection;
  const documents = selection
    ? (await workflowRepos(ctx.repos).selection.listBySelection(scopeOf(workflow), selection)).map(
        serialise,
      )
    : [];

  const base = {
    event: 'schedule',
    workflow: { id: workflow.id, name: workflow.name },
    space,
    at: ctx.now().toISOString(),
  };
  const environment = await environmentInfo(ctx, workflow);

  if (workflow.trigger.perDocument) {
    for (const document of documents) {
      await enqueueUnlessRefused(
        ctx,
        workflow,
        'schedule',
        runContext(base, {
          ...environment,
          content: document,
          url: documentUrl(ctx, String(document.id), environment.environment),
        }),
      );
    }
    return;
  }
  await enqueueUnlessRefused(
    ctx,
    workflow,
    'schedule',
    runContext(base, { ...environment, documents }),
  );
}

/** Starts a live workflow with a `manual` trigger for whoever is acting; returns the run id. */
export async function startManual(
  ctx: EngineContext,
  workflow: WorkflowRow,
  input: Record<string, unknown>,
): Promise<string> {
  const context = runContext(
    {
      event: 'manual',
      workflow: { id: workflow.id, name: workflow.name },
      space: await spaceInfo(ctx, workflow.spaceId),
      at: ctx.now().toISOString(),
    },
    { ...(await environmentInfo(ctx, workflow)), input, actor: await startedBy(ctx) },
  );
  return enqueue(ctx, workflow, 'manual', context);
}

/** The user acting now, if one is. */
function startedBy(ctx: EngineContext): Promise<WorkflowActor | null> {
  const actor = currentActor();
  return actorInfo(ctx, actor.kind === 'user' ? actor.id : null);
}

/**
 * Runs the draft inline so the caller sees the log. A called or manual workflow gets
 * `input`, blanks by default; a contributed kind what its `sample` makes of the sample.
 */
export async function testRun(
  ctx: EngineContext,
  workflow: WorkflowRow,
  sample: WorkflowTestSample,
): Promise<WorkflowRunRow> {
  await beforeRun(ctx, workflow, 'manual', true);
  const document = sample.document ?? null;
  const input = sample.input ?? null;
  const space = await spaceInfo(ctx, workflow.spaceId);
  const environment = await environmentInfo(ctx, workflow);
  const documents =
    workflow.trigger.kind === 'schedule' && workflow.trigger.selection && !document
      ? (
          await workflowRepos(ctx.repos).selection.listBySelection(
            scopeOf(workflow),
            workflow.trigger.selection,
          )
        ).map(serialise)
      : [];
  const run = await workflowRepos(ctx.repos).runs.create({
    workflowId: workflow.id,
    spaceId: workflow.spaceId,
    trigger: 'manual',
    test: true,
    definition: snapshotOf(workflow),
    context: runContext(
      {
        event: 'manual',
        workflow: { id: workflow.id, name: workflow.name },
        space,
        at: ctx.now().toISOString(),
      },
      {
        ...environment,
        // A contributed kind's stand-in start, so its placeholders have the expected shape.
        ...(ctx.registry
          .trigger(workflow.trigger.kind)
          ?.sample?.(workflow.trigger, sample as Record<string, unknown>) ?? {}),
        content: document ? serialise(document) : null,
        documents,
        url: document ? documentUrl(ctx, document.id, environment.environment) : null,
        ...(workflow.trigger.kind === 'call' || workflow.trigger.kind === 'manual'
          ? {
              input: {
                ...Object.fromEntries(workflow.trigger.parameters.map((entry) => [entry.name, ''])),
                ...input,
              },
            }
          : {}),
        ...(workflow.trigger.kind === 'manual' ? { actor: await startedBy(ctx) } : {}),
      },
    ),
  });
  await ctx.run(run.id);
  return (await workflowRepos(ctx.repos).runs.findById(run.id)) ?? run;
}
