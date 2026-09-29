import { attachInvalidation, type TaggedCache } from '@manablox/cache';
import {
  ManabloxError,
  type ManabloxPlugin,
  type PluginChannel,
  pluginFeatureKey,
  pluginId,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import { type DatabaseContext, databaseContextOf, type Repositories } from '@manablox/db';
import {
  type JobHandlers,
  type JobRunner,
  type JobSchedule,
  MAINTENANCE_SCHEDULE,
  type PluginJobName,
} from '@manablox/jobs';
import type { CredentialService, Mailer, Pusher } from '@manablox/services';
import type { Runtime } from './bootstrap.js';

/** Core services only a management instance builds; `null` in the other modes. */
interface PluginManagementServices {
  /** The credential vault. */
  credentials: CredentialService | null;
  /** Sends mail; also `null` without a transport. */
  mailer: Mailer | null;
  /** Sends web push; also `null` without VAPID keys. */
  pusher: Pusher | null;
}

/** Core services a plugin's `services` may use. */
export type PluginCoreServices = PluginManagementServices &
  Pick<
    Runtime,
    | 'storage'
    | 'media'
    | 'content'
    | 'contentTypes'
    | 'spaces'
    | 'environments'
    | 'users'
    | 'menus'
    | 'tags'
    | 'roles'
    | 'audit'
    | 'realtime'
    | 'hostVerifier'
  >;

type JobsOptions = Parameters<JobRunner['enqueue']>[2];

/** Queues the plugin's own jobs by their short name. */
export interface PluginJobs {
  enqueue(name: string, payload?: Record<string, unknown>, options?: JobsOptions): Promise<void>;
  /** Queues several of the plugin's jobs in one round trip. */
  enqueueMany(
    jobs: ReadonlyArray<{ name: string; payload?: Record<string, unknown>; options?: JobsOptions }>,
  ): Promise<void>;
  /**
   * Whether jobs run in this process, without a worker: `enqueue` starts the job and returns
   * without waiting for it.
   */
  readonly inline: boolean;
}

declare module '@manablox/core' {
  interface PluginContext<S = unknown> {
    readonly repos: Repositories;
    /** For the plugin's repositories; see `databaseContextOf` for one inside a transaction. */
    readonly db: DatabaseContext;
    readonly cache: TaggedCache;
    readonly jobs: PluginJobs;
    /** The core services, as the process built them. */
    readonly core: PluginCoreServices;
    /**
     * A channel to the instance's other processes, `name` unique within the plugin; see
     * `PluginChannel`. The same name gives the same channel.
     */
    channel<T = unknown>(name: string): PluginChannel<T>;
  }

  interface PluginServicesContext {
    readonly repos: Repositories;
    readonly db: DatabaseContext;
    readonly cache: TaggedCache;
  }
}

interface PluginBoot {
  manablox: Manablox;
  repos: Repositories;
  cache: TaggedCache;
  jobs: JobRunner;
  jobHandlers: JobHandlers;
  core: PluginCoreServices;
}

/** Runs each plugin resource kind's `check` over its declared entries. */
export function checkPluginResources(manablox: Manablox): void {
  const entries = manablox.config.resources.plugins;
  for (const plugin of manablox.config.plugins) {
    for (const [kind, spec] of Object.entries(plugin.resourceKinds ?? {})) {
      spec.check?.(entries[kind] ?? []);
    }
  }
}

/**
 * Builds each plugin's services and fills its context, adds its feature ceilings and
 * registers its job handlers. Returns the plugins' maintenance schedule.
 */
export function bootPlugins(boot: PluginBoot): JobSchedule {
  const { manablox, repos, cache, jobs, jobHandlers } = boot;
  const schedule: JobSchedule = {};
  const db = databaseContextOf(repos);

  for (const plugin of manablox.config.plugins) {
    const id = pluginId(plugin.name);
    const context = manablox.plugin(plugin.name);
    const jobName = (name: string): PluginJobName => `${id}:${name}`;
    manablox.providePlugin(plugin.name, {
      repos,
      db,
      cache,
      jobs: {
        enqueue: (name, payload = {}, options) => jobs.enqueue(jobName(name), payload, options),
        enqueueMany: (list) =>
          jobs.enqueueMany(
            list.map((job) => ({
              name: jobName(job.name),
              payload: job.payload ?? {},
              options: job.options,
            })),
          ),
        inline: jobs.inline,
      } satisfies PluginJobs,
      core: boot.core,
      channel: pluginChannels(manablox, plugin),
    });
    if (plugin.services) {
      manablox.providePlugin(plugin.name, {
        services: plugin.services({
          plugin: context,
          manablox,
          logger: context.logger,
          repos,
          db,
          cache,
        }),
      });
    }
    // In every mode: each process resolves its controls under the ceilings.
    if (plugin.ceilings) manablox.ceilings.add(plugin.ceilings(context));

    const gated = (name: string, run: (payload: Record<string, unknown>) => Promise<void>) => {
      const full = jobName(name);
      if (Object.hasOwn(jobHandlers, full) || Object.hasOwn(MAINTENANCE_SCHEDULE, full)) {
        throw ManabloxError.conflict('plugin.key.duplicate', {
          kind: 'job',
          key: full,
          plugins: ['core', plugin.name],
        });
      }
      jobHandlers[full] = (async (payload: Record<string, unknown> | undefined) => {
        const spaceId = typeof payload?.spaceId === 'string' ? payload.spaceId : null;
        if (!(await isOn(manablox, plugin, spaceId))) {
          context.logger.debug({ job: full, spaceId }, 'plugin off, job skipped');
          return;
        }
        await run(payload ?? {});
      }) as (payload: never) => Promise<void>;
      return full;
    };
    for (const [name, handler] of Object.entries(plugin.jobs ?? {})) {
      gated(name, (payload) => handler(payload, context));
    }
    for (const task of plugin.maintenance ?? []) {
      schedule[gated(task.name, () => task.run(context))] = task.every;
    }
  }
  return schedule;
}

/**
 * Runs each plugin's `start` in boot order and has its `stop` run on shutdown, in reverse. A
 * failing `start` stops the boot.
 */
export async function startPlugins(manablox: Manablox): Promise<void> {
  for (const plugin of manablox.config.plugins) {
    const context = manablox.plugin(plugin.name);
    if (plugin.stop) {
      const stop = plugin.stop;
      manablox.onDispose(async () => {
        try {
          await stop(context);
        } catch (error) {
          context.logger.error({ err: error }, 'plugin stop failed');
        }
      });
    }
    await plugin.start?.(context);
  }
}

const CHANNEL_NAME = /^[a-z][a-z0-9_.-]*$/i;

/** The plugin's `channel`: one Redis subscription per name, shared by its listeners. */
function pluginChannels(
  manablox: Manablox,
  plugin: ManabloxPlugin,
): <T>(name: string) => PluginChannel<T> {
  const id = pluginId(plugin.name);
  const logger = manablox.plugin(plugin.name).logger;
  const channels = new Map<string, PluginChannel>();
  return <T>(name: string): PluginChannel<T> => {
    if (!CHANNEL_NAME.test(name))
      throw new Error(`Invalid channel name of ${plugin.name}: ${name}`);
    const known = channels.get(name);
    if (known) return known as PluginChannel<T>;
    const listeners = new Set<(message: unknown) => void>();
    const deliver = (message: unknown) => {
      for (const listener of listeners) {
        try {
          listener(message);
        } catch (error) {
          logger.error({ err: error, channel: name }, 'channel listener failed');
        }
      }
    };
    const bus = attachInvalidation(manablox, `plugin:${id}:${name}`, (raw) => {
      if (raw === undefined) return deliver(undefined);
      try {
        deliver(JSON.parse(raw));
      } catch (error) {
        logger.debug({ err: error, channel: name }, 'channel message dropped');
      }
    });
    const channel: PluginChannel = {
      publish: (message) => bus?.publish(JSON.stringify(message ?? null)),
      subscribe: (listener) => {
        listeners.add(listener as (message: unknown) => void);
        return () => listeners.delete(listener as (message: unknown) => void);
      },
    };
    channels.set(name, channel);
    return channel as PluginChannel<T>;
  };
}

async function isOn(
  manablox: Manablox,
  plugin: ManabloxPlugin,
  spaceId: string | null,
): Promise<boolean> {
  return (await manablox.controls.feature(spaceId, pluginFeatureKey(plugin))).enabled;
}
