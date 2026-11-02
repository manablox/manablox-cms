import { ManabloxError } from '@manablox/core';
import { assertUsable } from './answer.js';
import { requestJson, transport } from './http.js';
import type { AiProviderClient, ProviderCall, TextResult } from './types.js';

const BASE = 'https://api.anthropic.com/v1';
/** Messages API version header, independent of the model. */
const API_VERSION = '2023-06-01';

interface MessagesResponse {
  content: Array<{ type: string; text?: string }>;
  stop_reason?: string;
}

function headers(apiKey: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': API_VERSION,
  };
}

/** Claude via the Messages API, over plain `fetch` to avoid an SDK dependency. */
export const anthropicProvider: AiProviderClient = {
  kind: 'anthropic',
  capabilities: ['text'],

  async generateText(call: ProviderCall): Promise<TextResult> {
    const body = await requestJson<MessagesResponse>(
      `${BASE}/messages`,
      {
        method: 'POST',
        headers: headers(call.apiKey),
        body: JSON.stringify({
          model: call.model,
          max_tokens: call.maxTokens ?? 16000,
          system: call.system,
          messages: [{ role: 'user', content: call.prompt }],
        }),
      },
      transport('anthropic', call),
    );

    // A safety decline is a 200 with no text.
    assertUsable('anthropic', body.stop_reason);

    const text = body.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('')
      .trim();
    if (!text) throw ManabloxError.badRequest('plugins.ai.response.empty');
    return { text };
  },

  async verify(call): Promise<void> {
    await requestJson<MessagesResponse>(
      `${BASE}/messages`,
      {
        method: 'POST',
        headers: headers(call.apiKey),
        body: JSON.stringify({
          model: call.model,
          max_tokens: 16,
          messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
        }),
      },
      transport('anthropic', call),
    );
  },
};
