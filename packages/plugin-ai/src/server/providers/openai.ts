import { ManabloxError } from '@manablox/core';
import { requestJson, transport } from './http.js';
import { openAiChat } from './openai-chat.js';
import type { AiProviderClient, ProviderCall, TextResult } from './types.js';

const BASE = 'https://api.openai.com/v1';

function headers(apiKey: string): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` };
}

/** ChatGPT via chat completions, over plain `fetch`. */
export const openaiProvider: AiProviderClient = {
  kind: 'openai',
  capabilities: ['text'],

  async generateText(call: ProviderCall): Promise<TextResult> {
    const content = await openAiChat(`${BASE}/chat/completions`, call, {
      provider: 'openai',
      headers: headers(call.apiKey),
      tokenField: 'max_completion_tokens',
      maxTokens: call.maxTokens,
      json: Boolean(call.json),
    });
    const text = content.trim();
    if (!text) throw ManabloxError.badRequest('plugins.ai.response.empty');
    return { text };
  },

  async verify(call): Promise<void> {
    // Listing models proves the key without spending tokens.
    await requestJson<unknown>(
      `${BASE}/models`,
      { headers: headers(call.apiKey) },
      transport('openai', call),
    );
  },
};
