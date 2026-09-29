import {
  defineJob,
  definePlugin,
  extensionPoint,
  type ManabloxPlugin,
  type PluginContext,
} from '@manablox/core';
import { pluginPackage } from '@manablox/core/node';
import { z } from 'zod';
import type { AnyWorkflowAction } from '../define/action.js';
import type {
  AnyWorkflowAbortTriggerKind,
  AnyWorkflowTriggerKind,
  WorkflowDesignHint,
  WorkflowFieldKindDefinition,
} from '../define/triggers.js';
import { workflowAudit } from './audit.js';
import { workflowResourceKinds } from './code-resources.js';
import { workflowControls } from './controls.js';
import { workflowsData } from './data.js';
import { workflowRepos } from './db/index.js';
import * as tables from './db/tables.js';
import { workflowHooks } from './engine/triggers.js';
import { workflowErrors } from './errors.js';
import type {} from './hooks.js';
import { WORKFLOWS } from './keys.js';
import { workflowLlms } from './llms.js';
import { workflowPermissions } from './permissions.js';
import { builtinContributions } from './registry.js';
import { workflowRpc } from './rpc.js';
import {
  type WorkflowsOptions,
  type WorkflowsServices,
  workflowServices,
} from './services/index.js';

export type WorkflowsPluginOptions = WorkflowsOptions;

/** How often finished runs past the kept ones are pruned. */
const PRUNE_RUNS_EVERY_MS = 10 * 60_000;

/** Throws when a contributed entry has no name to be found by. */
const named = (what: string, name: unknown, contributor: string) => {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error(`${contributor}: a workflow ${what} needs a name.`);
  }
};

/**
 * Workflows: automations editors build in the admin, started by content changes, schedules,
 * other workflows, by hand and by the trigger kinds other plugins contribute. Other plugins add
 * actions, trigger kinds, field kinds and design hints through its extension points.
 */
export function workflowsPlugin(
  options: WorkflowsPluginOptions = {},
): ManabloxPlugin<WorkflowsServices> {
  const pkg = pluginPackage(import.meta.url);
  return definePlugin<WorkflowsServices>({
    name: WORKFLOWS,
    description:
      'Workflows: automations started by content changes, schedules, calls and other plugins.',
    // Designs through the AI plugin's services when it is there.
    enhances: ['ai'],
    db: {
      tables,
      migrations: pkg.migrations,
    },
    extensionPoints: {
      actions: extensionPoint<AnyWorkflowAction>({
        description: 'Actions the editor offers as nodes; each carries its own form.',
        check: (entry, contributor) => named('action', entry.type, contributor),
      }),
      triggers: extensionPoint<AnyWorkflowTriggerKind>({
        description: 'Kinds of what starts a workflow; contributed kinds start with `runTrigger`.',
        check: (entry, contributor) => named('trigger kind', entry.kind, contributor),
      }),
      abortTriggers: extensionPoint<AnyWorkflowAbortTriggerKind>({
        description: "Kinds of what stops a workflow's active runs.",
        check: (entry, contributor) => named('abort trigger kind', entry.kind, contributor),
      }),
      fieldKinds: extensionPoint<WorkflowFieldKindDefinition>({
        description: 'Field kinds action forms may use; the admin draws them in a slot.',
        check: (entry, contributor) => named('field kind', entry.kind, contributor),
      }),
      designHints: extensionPoint<WorkflowDesignHint>({
        description: "Paragraphs for the AI designer's prompt.",
      }),
    },
    // The built-in actions and trigger kinds come through the same points.
    contributions: { workflows: builtinContributions() },
    permissions: workflowPermissions,
    controls: workflowControls,
    audit: workflowAudit,
    errors: workflowErrors,
    services: workflowServices(options),
    jobs: {
      // Queued runs, on the worker.
      run: defineJob(
        z.object({ runId: z.string() }),
        async ({ runId }, plugin: PluginContext<WorkflowsServices>) => {
          await plugin.services.engine.run(runId);
        },
      ),
    },
    maintenance: [
      {
        name: 'pruneRuns',
        every: PRUNE_RUNS_EVERY_MS,
        run: async (plugin) => {
          await workflowRepos(plugin.repos).runs.prune();
        },
      },
    ],
    // Content and other events start and stop workflows where the engine listens.
    hooks: workflowHooks,
    // Each management replica runs the clock; claims start a scheduled minute once.
    start: (plugin) => {
      plugin.services.engine.listen();
      plugin.services.engine.start();
    },
    stop: (plugin) => plugin.services.engine.stop(),
    resourceKinds: workflowResourceKinds,
    rpc: workflowRpc,
    data: [workflowsData],
    admin: { dir: pkg.adminDir },
    llms: workflowLlms,
  });
}
