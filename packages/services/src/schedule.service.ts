import type { Manablox } from '@manablox/core/node';
import { runAsActor, systemActor } from '@manablox/core/node';
import type { ContentRow, Repositories } from '@manablox/db';

/** What the scheduler does with a document whose date has come. */
export interface ScheduleTarget {
  publish(spaceId: string, id: string): Promise<unknown>;
  unpublish(spaceId: string, id: string): Promise<unknown>;
}

export interface ScheduleServiceOptions {
  /** How often the clock looks for due documents. */
  tickMs?: number | undefined;
  /** Documents claimed per pass and direction. */
  batchSize?: number | undefined;
  /** For tests. */
  now?: (() => Date) | undefined;
}

/** What one pass did. */
export interface ScheduleTickResult {
  published: string[];
  unpublished: string[];
  failed: string[];
}

/**
 * Polls `publish_at` and `unpublish_at` so the row stays the source of truth. Runs on
 * management instances only; asset windows are enforced per request instead.
 */
export class ScheduleService {
  private readonly tickMs: number;
  private readonly batchSize: number;
  private readonly now: () => Date;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<ScheduleTickResult> | null = null;

  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
    private readonly target: ScheduleTarget,
    options: ScheduleServiceOptions = {},
  ) {
    this.tickMs = options.tickMs ?? 20_000;
    this.batchSize = options.batchSize ?? 50;
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    // Must not keep the process alive.
    this.timer.unref?.();
    this.manablox.onDispose(() => this.stop());
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.idle();
  }

  /** Resolves once the pass in flight has finished. */
  async idle(): Promise<void> {
    // The pass logs its own failure; only its end matters here.
    while (this.running) await this.running.catch(() => undefined);
  }

  /** One pass; overlapping passes are skipped since rows are claimed up front. */
  async tick(): Promise<ScheduleTickResult> {
    if (this.running) return this.running;
    this.running = this.runPass().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runPass(): Promise<ScheduleTickResult> {
    const result: ScheduleTickResult = { published: [], unpublished: [], failed: [] };
    try {
      return await this.claimAndApply(result, this.now());
    } catch (error) {
      // An unhandled timer rejection would crash the process; the next tick retries.
      this.manablox.logger.error({ err: error }, 'schedule tick failed');
      return result;
    }
  }

  private async claimAndApply(result: ScheduleTickResult, at: Date): Promise<ScheduleTickResult> {
    // Claim both before applying, so a window that passed between ticks runs in order.
    const due = {
      publish: await this.repos.content.claimDuePublications(at, this.batchSize),
      unpublish: await this.repos.content.claimDueUnpublications(at, this.batchSize),
    };
    if (due.publish.length === 0 && due.unpublish.length === 0) return result;

    // The scheduler is the audit actor; rows are applied one at a time, in claim order.
    await runAsActor(systemActor('schedule'), async () => {
      for (const row of due.publish) {
        if (await this.apply('publish', row)) result.published.push(row.id);
        else result.failed.push(row.id);
      }
      for (const row of due.unpublish) {
        if (await this.apply('unpublish', row)) result.unpublished.push(row.id);
        else result.failed.push(row.id);
      }
    });

    return result;
  }

  /** One document. Failures are logged, not retried: the claim cleared the date. */
  private async apply(action: 'publish' | 'unpublish', row: ContentRow): Promise<boolean> {
    try {
      await this.target[action](row.spaceId, row.id);
      this.manablox.logger.info(
        { contentId: row.id, spaceId: row.spaceId, title: row.title, action },
        'scheduled content change applied',
      );
      return true;
    } catch (error) {
      this.manablox.logger.error(
        { contentId: row.id, spaceId: row.spaceId, action, err: error },
        'scheduled content change failed; the schedule has been cleared',
      );
      return false;
    }
  }
}
