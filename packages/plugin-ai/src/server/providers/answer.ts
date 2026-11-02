import { ManabloxError } from '@manablox/core';

/** Stop reasons for an answer withheld by a safety filter. */
const FILTERED = new Set([
  'refusal',
  'content_filter',
  'safety',
  'prohibited_content',
  'blocklist',
  'spii',
  'image_safety',
]);

/** Stop reasons for an answer cut off at the token limit. */
const TRUNCATED = new Set(['length', 'max_tokens', 'model_context_window_exceeded']);

/** Throws for a filtered or truncated answer; other reasons pass. */
export function assertUsable(provider: string, reason: string | null | undefined): void {
  if (!reason) return;
  const normal = reason.toLowerCase();
  if (FILTERED.has(normal)) {
    throw ManabloxError.badRequest('plugins.ai.response.filtered', { provider, reason });
  }
  if (TRUNCATED.has(normal)) {
    throw ManabloxError.badRequest('plugins.ai.response.truncated', { provider, reason });
  }
}
