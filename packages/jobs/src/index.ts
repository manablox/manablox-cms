import { createRedis, REDIS_PREFIX } from '@manablox/cache';
import { RetryLater } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import { runAsActor, systemActor } from '@manablox/core/node';
import { DelayedError, type JobsOptions, Queue, Worker } from 'bullmq';

export interface JobPayloads {
  'media:derive': { assetId: string; preset: string; format: string };
  'maintenance:pruneApiKeys': Record<string, never>;
  'maintenance:reconcileCounters': Record<string, never>;
  'controls:flushUsage': Record<string, never>;
  'controls:deliverEvents': Record<string, never>;
  'maintenance:pruneControlEvents': Record<string, never>;
  'maintenance:retention': Record<string, never>;
  'maintenance:snapshots': Record<string, never>;
  'maintenance:verifyDomains': Record<string, never>;
}

export type JobName = keyof JobPayloads;

export type JobHandler<K extends JobName> = (payload: JobPayloads[K]) => Promise<void>;

/** A plugin's job, `<pluginId>:<name>`. */
export type PluginJobName = `${string}:${string}`;

/** Handlers by job name; the host fills in those its services own, plugins theirs. */
export type JobHandlers = { [K in JobName]?: JobHandler<K> } & {
  [name: PluginJobName]: ((payload: never) => Promise<void>) | undefined;
};

/** Maintenance jobs with no payload. */
export type MaintenanceJob = {
  [K in JobName]: JobPayloads[K] extends Record<string, never> ? K : never;
}[JobName];

/** Intervals in milliseconds by job name. */
export type JobSchedule = Partial<Record<MaintenanceJob | PluginJobName, number>>;

export const PRUNE_API_KEYS_EVERY_MS = 60 * 60_000;
export const RECONCILE_COUNTERS_EVERY_MS = 24 * 60 * 60_000;
export const FLUSH_USAGE_EVERY_MS = 60_000;
/** The sweep behind the pushes that follow each event; runs only with a webhook URL. */
export const DELIVER_CONTROL_EVENTS_EVERY_MS = 60_000;
export const PRUNE_CONTROL_EVENTS_EVERY_MS = 60 * 60_000;
export const RETENTION_EVERY_MS = 24 * 60 * 60_000;
/** Takes due snapshots, prunes old ones and purges kept asset files. */
export const SNAPSHOTS_EVERY_MS = 15 * 60_000;
/** Checks the DNS of unverified custom domains and API hosts. */
export const VERIFY_DOMAINS_EVERY_MS = 10 * 60_000;

/** Maintenance jobs and how often each runs. */
export const MAINTENANCE_SCHEDULE: Record<MaintenanceJob, number> = {
  'maintenance:pruneApiKeys': PRUNE_API_KEYS_EVERY_MS,
  'maintenance:reconcileCounters': RECONCILE_COUNTERS_EVERY_MS,
  'controls:flushUsage': FLUSH_USAGE_EVERY_MS,
  'controls:deliverEvents': DELIVER_CONTROL_EVENTS_EVERY_MS,
  'maintenance:pruneControlEvents': PRUNE_CONTROL_EVENTS_EVERY_MS,
  'maintenance:retention': RETENTION_EVERY_MS,
  'maintenance:snapshots': SNAPSHOTS_EVERY_MS,
  'maintenance:verifyDomains': VERIFY_DOMAINS_EVERY_MS,
};

/** One job per variant, so a duplicate waits on the queued one; bounded retries. */
export function mediaDeriveJobOptions(payload: JobPayloads['media:derive']): JobsOptions {
  return {
    jobId: `derive-${payload.assetId}-${payload.preset}-${payload.format}`,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: true,
  };
}

export interface JobRunner {
  enqueue<K extends JobName>(
    name: K,
    payload: JobPayloads[K],
    options?: JobsOptions,
  ): Promise<void>;
  enqueue(
    name: PluginJobName,
    payload: Record<string, unknown>,
    options?: JobsOptions,
  ): Promise<void>;
  /**
   * Runs payload-less jobs every interval: repeatable jobs on Redis (one run across replicas,
   * keyed by name), an in-process timer without it.
   */
  schedule(schedule: JobSchedule): Promise<void>;
  /** Queues several jobs in one round trip (`addBulk` on Redis). */
  enqueueMany(
    jobs: ReadonlyArray<{
      name: JobName | PluginJobName;
      payload: Record<string, unknown>;
      options?: JobsOptions | undefined;
    }>,
  ): Promise<void>;
  /** Stops timers, worker and queue and disconnects, after inline jobs finished; safe twice. */
  close(): Promise<void>;
  /**
   * True when jobs run in this process: `enqueue` starts the job and returns without waiting
   * for it (the caller's request does not wait on an outgoing call); `idle` waits for them.
   */
  inline: boolean;
  /** Resolves once every job started inline so far has finished; at once with Redis. */
  idle(): Promise<void>;
}

/** What the runner needs from the host. */
export type JobHost = Pick<Manablox, 'config' | 'logger' | 'onDispose'>;

/** Background jobs, queued on Redis or run inline without it. */
export function createJobRunner(
  manablox: JobHost,
  handlers: JobHandlers = {},
  /** `worker: false` only enqueues, leaving the jobs to another process's worker. */
  options: { worker?: boolean } = {},
): JobRunner {
  const redisUrl = manablox.config.cache.redisUrl;
  const run = (name: string, payload: unknown) =>
    runAsActor(systemActor(`job:${name}`), () => runJob(manablox, handlers, name, payload));

  // Without Redis, jobs run in this process in the background and schedules on timers.
  if (!redisUrl) {
    const timers: Array<ReturnType<typeof setInterval>> = [];
    const retries = new Set<ReturnType<typeof setTimeout>>();
    const running = new Set<Promise<void>>();
    const idle = async () => {
      while (running.size > 0) await Promise.allSettled([...running]);
    };
    const close = async () => {
      for (const timer of timers.splice(0)) clearInterval(timer);
      for (const retry of retries) clearTimeout(retry);
      retries.clear();
      await idle();
    };
    manablox.onDispose(close);
    // A job that has to wait runs again on a timer; the caller does not wait for it.
    const runOrRetry = async (name: string, payload: unknown): Promise<void> => {
      try {
        await run(name, payload);
      } catch (error) {
        if (!RetryLater.is(error)) throw error;
        const retry = setTimeout(() => {
          retries.delete(retry);
          runOrRetry(name, payload).catch((failure: unknown) =>
            manablox.logger.warn({ job: name, err: failure }, 'job failed'),
          );
        }, error.delay);
        retry.unref?.();
        retries.add(retry);
      }
    };
    // Started now, not awaited: failures are logged like a worker's.
    const start = (name: string, payload: unknown) => {
      const job = runOrRetry(name, payload)
        .catch((error: unknown) => manablox.logger.warn({ job: name, err: error }, 'job failed'))
        .finally(() => running.delete(job));
      running.add(job);
    };
    return {
      inline: true,
      idle,
      async enqueue(name: string, payload: unknown) {
        start(name, payload);
      },
      async enqueueMany(jobs) {
        for (const job of jobs) start(job.name, job.payload);
      },
      async schedule(schedule) {
        for (const [name, every] of scheduled(schedule)) {
          const timer = setInterval(() => {
            run(name, {}).catch((error: unknown) =>
              manablox.logger.warn({ job: name, err: error }, 'job failed'),
            );
          }, every);
          timer.unref?.();
          timers.push(timer);
        }
      },
      close,
    };
  }

  const connection = createRedis(redisUrl, 'jobs');
  const prefix = `${REDIS_PREFIX}bull`;
  const queue = new Queue('manablox', { connection, prefix });

  const worker =
    options.worker === false
      ? null
      : new Worker(
          'manablox',
          async (job, token) => {
            try {
              await run(job.name, job.data);
            } catch (error) {
              // Back to the delayed set without spending an attempt.
              if (!RetryLater.is(error) || !token) throw error;
              await job.moveToDelayed(Date.now() + error.delay, token);
              throw new DelayedError();
            }
          },
          { connection, prefix, concurrency: 8, autorun: true },
        );

  worker?.on('failed', (job, error) => {
    manablox.logger.warn({ job: job?.name, jobId: job?.id, err: error }, 'job failed');
  });

  let closing: Promise<void> | null = null;
  const close = () => {
    closing ??= (async () => {
      await worker?.close();
      await queue.close();
      connection.disconnect();
    })();
    return closing;
  };
  manablox.onDispose(close);

  const defaults: JobsOptions = {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 500,
    removeOnFail: 1000,
  };
  return {
    inline: false,
    idle: async () => {},
    async enqueue(name: string, payload: unknown, options?: JobsOptions) {
      await queue.add(name, payload, { ...defaults, ...options });
    },
    async enqueueMany(jobs) {
      if (jobs.length === 0) return;
      await queue.addBulk(
        jobs.map((job) => ({
          name: job.name,
          data: job.payload,
          opts: { ...defaults, ...job.options },
        })),
      );
    },
    async schedule(schedule) {
      const wanted = scheduled(schedule);
      for (const [name, every] of wanted) {
        // Keyed by name, so every replica and restart updates the same schedule.
        await queue.upsertJobScheduler(
          name,
          { every },
          { name, data: {}, opts: { removeOnComplete: 50, removeOnFail: 100 } },
        );
      }
      // Drops schedules this version, or a removed plugin, no longer declares.
      const names = new Set<string>(wanted.map(([name]) => name));
      for (const existing of await queue.getJobSchedulers()) {
        if (!names.has(existing.key)) await queue.removeJobScheduler(existing.key);
      }
    },
    close,
  };
}

function scheduled(schedule: JobSchedule): Array<[string, number]> {
  return (Object.entries(schedule) as Array<[string, number | undefined]>).filter(
    (entry): entry is [string, number] => Boolean(entry[1] && entry[1] > 0),
  );
}

async function runJob(
  manablox: JobHost,
  handlers: JobHandlers,
  name: string,
  payload: unknown,
): Promise<void> {
  const handler = (handlers as Record<string, ((payload: unknown) => Promise<void>) | undefined>)[
    name
  ];
  if (!handler) {
    manablox.logger.warn({ job: name }, 'no handler for job');
    return;
  }
  await handler(payload);
}
