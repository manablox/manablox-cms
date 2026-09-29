import { RetryLater } from '@manablox/core';
import { currentActor } from '@manablox/core/node';
import { Queue } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createJobRunner,
  FLUSH_USAGE_EVERY_MS,
  type JobHandlers,
  type JobHost,
  MAINTENANCE_SCHEDULE,
  mediaDeriveJobOptions,
  PRUNE_API_KEYS_EVERY_MS,
} from '../src/index.js';

/** A host with the given Redis URL that collects dispose callbacks. */
function host(redisUrl?: string) {
  const disposers: Array<() => unknown> = [];
  const warn = vi.fn();
  const manablox = {
    config: { cache: { redisUrl } },
    logger: { warn },
    onDispose: (fn: () => unknown) => {
      disposers.push(fn);
    },
  } as unknown as JobHost;
  return { manablox, disposers, warn };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the job runner without Redis', () => {
  it('runs a job inline through its handler, as the job actor', async () => {
    const { manablox } = host();
    const seen: unknown[] = [];
    const handlers: JobHandlers = {
      'media:derive': async (payload) => {
        seen.push(payload, currentActor().label);
      },
    };
    const jobs = createJobRunner(manablox, handlers);

    await jobs.enqueue('media:derive', { assetId: 'a1', preset: 'thumb', format: 'webp' });
    await jobs.idle();

    expect(jobs.inline).toBe(true);
    expect(seen).toEqual([{ assetId: 'a1', preset: 'thumb', format: 'webp' }, 'job:media:derive']);
  });

  it('runs a job that asks to retry later again after its delay', async () => {
    vi.useFakeTimers();
    const { manablox } = host();
    let attempts = 0;
    const jobs = createJobRunner(manablox, {
      'hello:greet': async () => {
        attempts++;
        if (attempts === 1) throw new RetryLater(5_000);
      },
    });

    await jobs.enqueue('hello:greet', { greetingId: 'g1' });
    await jobs.idle();
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toBe(2);
    await jobs.close();
  });

  it('returns before the job finishes; idle and close wait for it; failures are logged', async () => {
    const { manablox, warn } = host();
    let release: () => void = () => {};
    const done = vi.fn();
    const jobs = createJobRunner(manablox, {
      'hello:slow': async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        done();
      },
      'hello:broken': async () => {
        throw new Error('remote away');
      },
    });
    await jobs.enqueueMany([
      { name: 'hello:slow', payload: {} },
      { name: 'hello:broken', payload: {} },
    ]);
    expect(done).not.toHaveBeenCalled();
    const closing = jobs.close();
    release();
    await closing;
    expect(done).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ job: 'hello:broken' }),
      'job failed',
    );
  });

  it('uses handlers the host adds after creating the runner', async () => {
    const { manablox } = host();
    const handlers: JobHandlers = {};
    const jobs = createJobRunner(manablox, handlers);
    const run = vi.fn(async () => undefined);
    handlers['hello:greet'] = run;

    await jobs.enqueue('hello:greet', { greetingId: 'g1' });
    await jobs.idle();

    expect(run).toHaveBeenCalledWith({ greetingId: 'g1' });
  });

  it('warns and skips a job with no handler', async () => {
    const { manablox, warn } = host();
    const jobs = createJobRunner(manablox);

    await jobs.enqueue('hello:greet', { greetingId: 'g1' });
    await jobs.idle();

    expect(warn).toHaveBeenCalledWith({ job: 'hello:greet' }, 'no handler for job');
  });

  it('runs maintenance on timers until closed', async () => {
    vi.useFakeTimers();
    const { manablox, disposers } = host();
    const keys = vi.fn(async () => undefined);
    const flushes = vi.fn(async () => undefined);
    const jobs = createJobRunner(manablox, {
      'maintenance:pruneApiKeys': keys,
      'controls:flushUsage': flushes,
    });

    await jobs.schedule(MAINTENANCE_SCHEDULE);
    await vi.advanceTimersByTimeAsync(PRUNE_API_KEYS_EVERY_MS);

    expect(keys).toHaveBeenCalledTimes(1);
    expect(flushes).toHaveBeenCalledTimes(PRUNE_API_KEYS_EVERY_MS / FLUSH_USAGE_EVERY_MS);

    // The host's dispose stops the timers.
    await Promise.all(disposers.map((dispose) => dispose()));
    await vi.advanceTimersByTimeAsync(PRUNE_API_KEYS_EVERY_MS);
    expect(keys).toHaveBeenCalledTimes(1);
  });

  it('logs a failed scheduled run and keeps the schedule', async () => {
    vi.useFakeTimers();
    const { manablox, warn } = host();
    const runs = vi.fn(async () => {
      throw new Error('database away');
    });
    const jobs = createJobRunner(manablox, { 'maintenance:snapshots': runs });

    await jobs.schedule({ 'maintenance:snapshots': 1000 });
    await vi.advanceTimersByTimeAsync(2000);

    expect(runs).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ job: 'maintenance:snapshots' }),
      'job failed',
    );
    await jobs.close();
  });
});

const redisUrl = process.env.TEST_REDIS_URL ?? '';

describe.skipIf(!redisUrl)('the job runner over Redis', () => {
  it('registers maintenance as repeatable jobs keyed by name, once across replicas', async () => {
    const one = host(redisUrl);
    const two = host(redisUrl);
    const first = createJobRunner(one.manablox, {}, { worker: false });
    const second = createJobRunner(two.manablox, {}, { worker: false });
    const queue = new Queue('manablox', {
      connection: { url: redisUrl },
      prefix: 'manablox:bull',
    });
    try {
      await queue.upsertJobScheduler('maintenance:retired', { every: 60_000 });
      // A plugin that is no longer loaded.
      await queue.upsertJobScheduler('hello:retired', { every: 60_000 });

      await first.schedule(MAINTENANCE_SCHEDULE);
      // A second replica, or a restart, updates the same schedules.
      await second.schedule(MAINTENANCE_SCHEDULE);

      const schedulers = await queue.getJobSchedulers();
      const maintenance = schedulers
        .map((entry) => ({ key: entry.key, name: entry.name, every: Number(entry.every) }))
        .sort((a, b) => a.key.localeCompare(b.key));
      expect(maintenance).toEqual(
        Object.entries(MAINTENANCE_SCHEDULE)
          .map(([key, every]) => ({ key, name: key, every }))
          .sort((a, b) => a.key.localeCompare(b.key)),
      );
    } finally {
      for (const key of Object.keys(MAINTENANCE_SCHEDULE)) await queue.removeJobScheduler(key);
      await queue.close();
      await first.close();
      await second.close();
    }
  });

  it('queues several jobs in one round trip', async () => {
    const { manablox } = host(redisUrl);
    const batch = `b-${Date.now()}`;
    const seen: string[] = [];
    const jobs = createJobRunner(manablox, {
      'hello:greet': async (payload: { greetingId: string }) => {
        if (payload.greetingId.startsWith(batch)) seen.push(payload.greetingId);
      },
    });
    try {
      await jobs.enqueueMany(
        ['1', '2', '3'].map((n) => ({
          name: 'hello:greet' as const,
          payload: { greetingId: `${batch}-${n}` },
        })),
      );
      await vi.waitFor(() =>
        expect(seen.sort()).toEqual([`${batch}-1`, `${batch}-2`, `${batch}-3`]),
      );
    } finally {
      await jobs.close();
    }
  });

  it('retries a failing media derive and logs each failure', async () => {
    const { manablox, warn } = host(redisUrl);
    const derive = vi.fn(async (_job: { assetId: string }) => {
      throw new Error('storage away');
    });
    const jobs = createJobRunner(manablox, { 'media:derive': derive });
    const payload = { assetId: `a-${Date.now()}`, preset: 'thumb', format: 'webp' };
    try {
      await jobs.enqueue('media:derive', payload, {
        ...mediaDeriveJobOptions(payload),
        backoff: { type: 'fixed', delay: 10 },
      });
      // The worker also takes jobs other tests left in the queue.
      const runs = () => derive.mock.calls.filter(([job]) => job.assetId === payload.assetId);
      await vi.waitFor(() => expect(runs()).toHaveLength(3), { timeout: 10_000 });
      const failures = () =>
        warn.mock.calls.filter(
          ([fields]) => fields.jobId === `derive-${payload.assetId}-thumb-webp`,
        );
      await vi.waitFor(() => expect(failures()).toHaveLength(3));
      expect(failures()[0]).toEqual([
        expect.objectContaining({ job: 'media:derive', err: expect.any(Error) }),
        'job failed',
      ]);
    } finally {
      await jobs.close();
    }
  });

  it('moves a job that asks to retry later back to the delayed set, without an attempt', async () => {
    const { manablox, warn } = host(redisUrl);
    const greetingId = `g-${Date.now()}`;
    const seen: number[] = [];
    const jobs = createJobRunner(manablox, {
      'hello:greet': async (payload: { greetingId: string }) => {
        if (payload.greetingId !== greetingId) return;
        seen.push(Date.now());
        if (seen.length === 1) throw new RetryLater(300);
      },
    });
    try {
      await jobs.enqueue('hello:greet', { greetingId }, { attempts: 1 });
      await vi.waitFor(() => expect(seen).toHaveLength(2), { timeout: 10_000 });
      expect((seen[1] ?? 0) - (seen[0] ?? 0)).toBeGreaterThanOrEqual(250);
      // Deferring is not a failure.
      expect(warn.mock.calls.filter(([fields]) => fields.job === 'hello:greet')).toHaveLength(0);
    } finally {
      await jobs.close();
    }
  });

  it('keeps one media derive per variant while it is queued', async () => {
    const { manablox } = host(redisUrl);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const derive = vi.fn((_job: { assetId: string }) => gate);
    const jobs = createJobRunner(manablox, { 'media:derive': derive });
    const payload = { assetId: `a-${Date.now()}`, preset: 'thumb', format: 'webp' };
    try {
      await jobs.enqueue('media:derive', payload, mediaDeriveJobOptions(payload));
      const runs = () => derive.mock.calls.filter(([job]) => job.assetId === payload.assetId);
      await vi.waitFor(() => expect(runs()).toHaveLength(1), { timeout: 10_000 });
      await jobs.enqueue('media:derive', payload, mediaDeriveJobOptions(payload));
      release();
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(runs()).toHaveLength(1);
    } finally {
      release();
      await jobs.close();
    }
  });

  it('runs a queued job on the worker and closes once', async () => {
    const { manablox, disposers } = host(redisUrl);
    const run = vi.fn(async () => undefined);
    const jobs = createJobRunner(manablox, { 'hello:greet': run });

    await jobs.enqueue('hello:greet', { greetingId: `g-${Date.now()}` });
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce(), { timeout: 10_000 });

    // The host's dispose and a direct close share one shutdown.
    await Promise.all([jobs.close(), ...disposers.map((dispose) => dispose())]);
    await jobs.close();
  });
});
