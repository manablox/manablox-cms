import type { PluginChannel, PluginServicesContext } from '@manablox/core';
import type {} from '@manablox/server';
import { workflowRepos } from '../db/index.js';
import { WorkflowEngine } from '../engine/index.js';
import type { WorkflowLimits } from '../ports.js';
import { WorkflowRegistry } from '../registry.js';
import { WorkflowService } from './workflow.service.js';

/** How long runs may take and how much a crawl reads. */
export interface WorkflowsOptions extends Partial<WorkflowLimits> {}

/** A space whose live workflows changed, as other processes hear of it. */
export interface WorkflowLiveMessage {
  spaceId: string;
}

/**
 * The plugin's services; others reach them with `plugins.get('workflows')`, e.g. to start runs
 * of a trigger kind they contribute with `engine.runTrigger`.
 */
export interface WorkflowsServices {
  /** Actions and trigger kinds of every configured plugin. */
  registry: WorkflowRegistry;
  engine: WorkflowEngine;
  workflows: WorkflowService;
  /** Tells the other processes to drop a space's cached live triggers. */
  live: PluginChannel<WorkflowLiveMessage>;
}

declare module '@manablox/core' {
  /** Other plugins reach the workflow services with `plugins.get('workflows')`. */
  interface PluginServicesMap {
    workflows: WorkflowsServices;
  }
}

/** Builds the services once per process; runs happen on management instances only. */
export function workflowServices(options: WorkflowsOptions) {
  return (context: PluginServicesContext): WorkflowsServices => {
    const { manablox, repos, plugin } = context;
    const { core } = plugin;
    const registry = WorkflowRegistry.fromPlugin(manablox, (point) => plugin.contributions(point));
    const { content } = core;
    const { jobs } = plugin;
    // Runs go through the queue if there is one, else in the background.
    const engine = new WorkflowEngine(manablox, repos, {
      mailer: core.mailer,
      pusher: core.pusher,
      credentials: core.credentials ?? undefined,
      content,
      adminUrl: manablox.config.server.adminUrl,
      registry,
      limits: options,
      ...(jobs.inline
        ? {}
        : {
            dispatch: (runId) => jobs.enqueue('run', { runId }),
            dispatchMany: (runIds) =>
              jobs.enqueueMany(runIds.map((runId) => ({ name: 'run', payload: { runId } }))),
          }),
    });
    const live = plugin.channel<WorkflowLiveMessage>('live');
    // Other replicas drop a space's live-trigger index when its workflows change here.
    live.subscribe((message) => engine.forgetLive(message?.spaceId));
    manablox.onDispose(
      workflowRepos(repos).workflows.onLiveChange((spaceId) => live.publish({ spaceId })),
    );
    return {
      registry,
      engine,
      workflows: new WorkflowService(manablox, repos, engine, core.credentials),
      live,
    };
  };
}
