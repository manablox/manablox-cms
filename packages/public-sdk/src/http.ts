import { ManabloxAbortError, ManabloxHttpError, ManabloxTimeoutError } from './errors.js';

export interface RetryOptions {
  /** Total attempts, including the first. `1` disables retrying. */
  attempts?: number;
  /** First backoff, in ms. Doubles each attempt, with jitter. */
  baseDelay?: number;
  maxDelay?: number;
}

export interface HttpOptions {
  fetch?: typeof globalThis.fetch;
  /** Per-request timeout in ms. `0` disables it. */
  timeout?: number;
  retry?: RetryOptions;
  requestInit?: RequestInit;
  headers?: Record<string, string>;
}

export interface HttpRequest {
  url: string;
  method: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

const DEFAULTS = { attempts: 3, baseDelay: 200, maxDelay: 2000 } as const;

/** `fetch` with a timeout, retry with backoff, and cancellation. */
export class Http {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly retry: Required<RetryOptions>;

  constructor(private readonly options: HttpOptions = {}) {
    // Unbound `fetch` throws "Illegal invocation" in browsers.
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.retry = { ...DEFAULTS, ...options.retry };
  }

  async request(request: HttpRequest): Promise<unknown> {
    const timeout = this.options.timeout ?? 10_000;
    let lastError: unknown;

    for (let attempt = 1; attempt <= Math.max(1, this.retry.attempts); attempt++) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      request.signal?.addEventListener('abort', abort, { once: true });

      const timer =
        timeout > 0 ? setTimeout(() => controller.abort('manablox-timeout'), timeout) : undefined;

      try {
        const response = await this.fetchImpl(request.url, {
          method: request.method,
          headers: { ...this.options.headers, ...request.headers },
          ...(request.body !== undefined ? { body: request.body } : {}),
          signal: controller.signal,
          ...this.options.requestInit,
        });

        if (!response.ok) {
          const error = new ManabloxHttpError(
            response.status,
            response.statusText,
            request.url,
            await safeText(response),
          );
          if (!isRetryable(response.status) || attempt === this.retry.attempts) throw error;
          lastError = error;
          await sleep(this.delayFor(attempt, response.headers.get('retry-after')));
          continue;
        }

        return await response.json();
      } catch (error) {
        // Never retry a caller abort.
        if (request.signal?.aborted) throw new ManabloxAbortError(request.url);
        if (isAbort(error)) {
          const timedOut = new ManabloxTimeoutError(request.url, timeout);
          if (attempt === this.retry.attempts) throw timedOut;
          lastError = timedOut;
          await sleep(this.delayFor(attempt, null));
          continue;
        }

        if (error instanceof ManabloxHttpError) throw error;
        if (attempt === this.retry.attempts) throw error;
        lastError = error;
        await sleep(this.delayFor(attempt, null));
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        request.signal?.removeEventListener('abort', abort);
      }
    }

    throw lastError;
  }

  /** `Retry-After` if sent, else jittered exponential backoff. */
  private delayFor(attempt: number, retryAfter: string | null): number {
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(seconds * 1000, this.retry.maxDelay);
      }
      const at = Date.parse(retryAfter);
      if (!Number.isNaN(at)) return Math.min(Math.max(0, at - Date.now()), this.retry.maxDelay);
    }

    const backoff = Math.min(this.retry.baseDelay * 2 ** (attempt - 1), this.retry.maxDelay);
    // Full jitter, so clients do not retry in lockstep.
    return Math.round(Math.random() * backoff);
  }
}

/** Only 5xx and 429 are retried. */
function isRetryable(status: number): boolean {
  return status >= 500 || status === 429;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

async function safeText(response: Response): Promise<string | undefined> {
  try {
    // Long enough for an error body with its details.
    return (await response.text()).slice(0, 16_384);
  } catch {
    return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
