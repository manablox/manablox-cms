import { ManabloxError } from '@manablox/core';

/**
 * Provider HTTP with a deadline and the host's guarded fetch. Failures become Manablox
 * errors carrying the provider's message, never the key.
 */

/** Generous, since media generation can take minutes. */
const DEFAULT_TIMEOUT_MS = 120_000;

export interface ProviderRequest {
  provider: string;
  /** Guarded `fetch` that refuses private-network addresses; global `fetch` when absent. */
  fetch?: typeof fetch | undefined;
  /** Caller cancellation. */
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
}

/** The transport options of a `ProviderCall`: guard, signal and deadline. */
export function transport(
  provider: string,
  call: {
    signal?: AbortSignal | undefined;
    fetch?: typeof fetch | undefined;
    timeoutMs?: number | undefined;
  },
  timeoutMs?: number,
): ProviderRequest {
  const deadline = timeoutMs ?? call.timeoutMs;
  return {
    provider,
    ...(call.fetch ? { fetch: call.fetch } : {}),
    ...(deadline === undefined ? {} : { timeoutMs: deadline }),
  };
}

/** Sends a request with deadline and guard, mapping failures to Manablox errors. */
async function send(url: string, init: RequestInit, context: ProviderRequest): Promise<Response> {
  const send = context.fetch ?? fetch;
  const deadline = AbortSignal.timeout(context.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = context.signal ? AbortSignal.any([context.signal, deadline]) : deadline;

  try {
    const response = await send(url, { ...init, signal });
    if (!response.ok) {
      throw ManabloxError.badRequest('plugins.ai.request.failed', {
        provider: context.provider,
        status: response.status,
        message: await messageFrom(response),
      });
    }
    return response;
  } catch (error) {
    // Only transport errors become `unreachable`.
    if (ManabloxError.is(error)) throw error;
    throw ManabloxError.badRequest('plugins.ai.provider.unreachable', {
      provider: context.provider,
      message: reasonFor(error, deadline, context),
    });
  }
}

export async function requestJson<T>(
  url: string,
  init: RequestInit,
  context: ProviderRequest,
): Promise<T> {
  return (await (await send(url, init, context)).json()) as T;
}

/** Fetches raw bytes, e.g. a generated video. */
export async function requestBytes(
  url: string,
  init: RequestInit,
  context: ProviderRequest,
): Promise<Buffer> {
  return Buffer.from(await (await send(url, init, context)).arrayBuffer());
}

/** Explains an abort: deadline, cancellation, or the error message. */
function reasonFor(error: unknown, deadline: AbortSignal, context: ProviderRequest): string {
  if (deadline.aborted) {
    return `no answer within ${Math.round((context.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)}s`;
  }
  if (context.signal?.aborted) return 'cancelled';
  return error instanceof Error ? error.message : String(error);
}

/** The provider's error message, trimmed. */
async function messageFrom(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const body = JSON.parse(text) as {
      error?: { message?: string } | string;
      message?: string;
    };
    const error = body.error;
    const message = (typeof error === 'string' ? error : error?.message) ?? body.message ?? text;
    return message.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}
