import type { Controls } from '@manablox/core';
import type { Repositories } from '@manablox/db';
import type { AiCapability } from '../../../sdk.js';
import { generationAuditor } from '../../audit.js';
import { aiKeys } from '../../keys.js';

/** Output tokens per word, including JSON and HTML overhead. */
const TOKENS_PER_WORD = 2.6;
/** Hard cap on output tokens. */
const MAX_OUTPUT_TOKENS = 64_000;
/** Default output ceiling; below it no maxTokens is sent. */
const BASE_OUTPUT_TOKENS = 16_000;
/** Approximate model output speed, for sizing timeouts. */
const TOKENS_PER_SECOND = 35;

/** Token ceiling and timeout for a target length, so long answers are not cut off. */
export function sizedFor(words: number | undefined): { maxTokens?: number; timeoutMs?: number } {
  if (!words) return {};
  const tokens = Math.min(Math.round(words * TOKENS_PER_WORD) + 4000, MAX_OUTPUT_TOKENS);
  if (tokens <= BASE_OUTPUT_TOKENS) {
    return { timeoutMs: Math.max(120_000, Math.round((tokens / TOKENS_PER_SECOND) * 1000)) };
  }
  return {
    maxTokens: tokens,
    timeoutMs: Math.min(Math.round((tokens / TOKENS_PER_SECOND) * 1000) + 60_000, 900_000),
  };
}

/**
 * Audit trail of what was generated (the provider label and a prompt excerpt, never the
 * answer), and one `plugins.ai.calls` usage count per call.
 */
export class AiUsage {
  constructor(
    private readonly repos: Repositories,
    private readonly controls?: () => Pick<Controls, 'consume'>,
  ) {}

  recordUse(
    spaceId: string,
    providerLabel: string,
    capability: AiCapability,
    prompt: string,
  ): Promise<unknown> {
    this.controls?.().consume(spaceId, aiKeys.usage.calls, 1);
    return generationAuditor(this.repos).record(
      'ai.generation.create',
      { id: null, spaceId, label: `${providerLabel}: ${capability}` },
      [{ path: 'prompt', from: null, to: prompt.slice(0, 500) }],
    );
  }
}
