import type { ControlEventType } from '@manablox/core';
import { type Manablox, signBody } from '@manablox/core/node';
import type { ControlEventRow, Repositories } from '@manablox/db';

/** Header carrying `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`. */
export const CONTROL_SIGNATURE_HEADER = 'x-manablox-signature';

/** Events per push. */
export const CONTROL_EVENTS_BATCH = 100;
/** Failed pushes after which an event is left for pull. */
export const CONTROL_EVENTS_MAX_ATTEMPTS = 10;

const DEBOUNCE_MS = 1000;
const BACKOFF_MS = 5000;
const MAX_BACKOFF_MS = 60 * 60_000;
const TIMEOUT_MS = 10_000;
/** Batches per run, so one run never holds the lock for long. */
const MAX_BATCHES = 50;

/** A control event as pull and push return it. */
export interface ControlEventView {
  seq: number;
  id: string;
  type: ControlEventType;
  /** `instance`, `group:<id>` or `space:<id>`. */
  scope: string;
  payload: Record<string, unknown>;
  createdAt: string;
  deliveredAt: string | null;
}

export function controlEventView(row: ControlEventRow): ControlEventView {
  return {
    seq: row.seq,
    id: row.id,
    type: row.type as ControlEventType,
    scope: row.scopeKind === 'instance' ? 'instance' : `${row.scopeKind}:${row.scopeId}`,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
    deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
  };
}

/** The `X-Manablox-Signature` value for `body`, sent at `t` (unix seconds). */
export function signControlEvents(secret: string, body: string, t: number): string {
  return `t=${t},v1=${signBody(secret, `${t}.${body}`, { format: 'hex' })}`;
}

export interface ControlEventDeliveryOptions {
  url: string;
  secret: string;
  /** An SSRF-guarded fetch. */
  fetch: typeof fetch;
  /** Queues a run for a worker; without it `trigger` runs in process. */
  queue?: (() => Promise<void>) | null | undefined;
  batchSize?: number | undefined;
  maxAttempts?: number | undefined;
  debounceMs?: number | undefined;
  backoffMs?: number | undefined;
  now?: (() => number) | undefined;
}

export interface ControlDeliveryResult {
  delivered: number;
  /** A push failed; the next run waits for the backoff. */
  failed: boolean;
}

/**
 * Pushes undelivered events in `seq` order, in signed batches. A failed push counts an attempt
 * on the events it carried and backs off exponentially; an event that failed before goes
 * alone, so one the receiver refuses holds the others back only until its attempts run out.
 */
export class ControlEventDelivery {
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<ControlDeliveryResult> | null = null;
  private again = false;
  private failures = 0;
  private retryAt = 0;
  private closed = false;
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly now: () => number;

  constructor(
    private readonly manablox: Pick<Manablox, 'logger'>,
    private readonly repos: Repositories,
    private readonly options: ControlEventDeliveryOptions,
  ) {
    this.batchSize = options.batchSize ?? CONTROL_EVENTS_BATCH;
    this.maxAttempts = options.maxAttempts ?? CONTROL_EVENTS_MAX_ATTEMPTS;
    this.now = options.now ?? Date.now;
  }

  /** Starts a run shortly; calls within the debounce window share it. */
  trigger(): void {
    if (this.closed || this.debounce) return;
    this.debounce = setTimeout(() => {
      this.debounce = null;
      this.kick(this.options.queue ?? null);
    }, this.options.debounceMs ?? DEBOUNCE_MS);
    this.debounce.unref?.();
  }

  /** Pushes what is pending; skipped while backing off. One run at a time per process. */
  run(): Promise<ControlDeliveryResult> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    if (this.closed || this.now() < this.retryAt) {
      return Promise.resolve({ delivered: 0, failed: false });
    }
    this.running = this.repos.locks
      .withLock('controls:deliverEvents', () => this.drain())
      .finally(() => {
        this.running = null;
        if (this.again && !this.closed) {
          this.again = false;
          this.kick(null);
        }
      });
    return this.running;
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.debounce) clearTimeout(this.debounce);
    if (this.retry) clearTimeout(this.retry);
    this.debounce = null;
    this.retry = null;
    await this.running?.catch(() => {});
  }

  private kick(queue: (() => Promise<void>) | null): void {
    const started = queue ? queue() : this.run();
    started.catch((error: unknown) =>
      this.manablox.logger.warn({ err: error }, 'control events not pushed'),
    );
  }

  private async drain(): Promise<ControlDeliveryResult> {
    let delivered = 0;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const pending = await this.repos.controlEvents.listUndelivered(
        this.batchSize,
        this.maxAttempts,
      );
      if (pending.length === 0) break;
      const retried = pending.findIndex((row) => row.attempts > 0);
      const batch =
        retried === 0 ? pending.slice(0, 1) : pending.slice(0, retried < 0 ? undefined : retried);
      const ids = batch.map((row) => row.id);
      if (!(await this.post(batch))) {
        await this.repos.controlEvents.incrementAttempts(ids);
        this.backOff();
        return { delivered, failed: true };
      }
      await this.repos.controlEvents.markDelivered(ids);
      delivered += batch.length;
      this.failures = 0;
      this.retryAt = 0;
      if (pending.length < this.batchSize && batch.length === pending.length) break;
    }
    return { delivered, failed: false };
  }

  private async post(batch: ControlEventRow[]): Promise<boolean> {
    const body = JSON.stringify({ events: batch.map(controlEventView) });
    const t = Math.floor(this.now() / 1000);
    try {
      const response = await this.options.fetch(this.options.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [CONTROL_SIGNATURE_HEADER]: signControlEvents(this.options.secret, body, t),
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.ok) return true;
      this.manablox.logger.warn(
        { status: response.status, events: batch.length },
        'control events refused by the webhook',
      );
    } catch (error) {
      this.manablox.logger.warn({ err: error, events: batch.length }, 'control events not pushed');
    }
    return false;
  }

  private backOff(): void {
    this.failures++;
    const base = this.options.backoffMs ?? BACKOFF_MS;
    const wait = Math.min(base * 2 ** (this.failures - 1), MAX_BACKOFF_MS);
    this.retryAt = this.now() + wait;
    if (this.retry) clearTimeout(this.retry);
    this.retry = setTimeout(() => {
      this.retry = null;
      // A timer may fire a little early; it ends the backoff.
      this.retryAt = 0;
      this.kick(null);
    }, wait);
    this.retry.unref?.();
  }
}
