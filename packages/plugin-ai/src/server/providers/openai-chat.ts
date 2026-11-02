import { assertUsable } from './answer.js';
import { requestJson, transport } from './http.js';
import type { ProviderCall } from './types.js';

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
}

export interface OpenAiChatOptions {
  provider: string;
  headers: Record<string, string>;
  /** `max_completion_tokens` for OpenAI, `max_tokens` for compatible servers. */
  tokenField: 'max_completion_tokens' | 'max_tokens';
  maxTokens?: number | undefined;
  /** Sends `response_format: json_object`. */
  json: boolean;
  timeoutMs?: number | undefined;
}

/** One chat completion; returns the first choice's raw content. */
export async function openAiChat(
  url: string,
  call: ProviderCall,
  opts: OpenAiChatOptions,
): Promise<string> {
  const body = await requestJson<ChatResponse>(
    url,
    {
      method: 'POST',
      headers: opts.headers,
      body: JSON.stringify({
        model: call.model,
        stream: false,
        messages: [
          ...(call.system ? [{ role: 'system', content: call.system }] : []),
          { role: 'user', content: call.prompt },
        ],
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
        ...(opts.maxTokens ? { [opts.tokenField]: opts.maxTokens } : {}),
      }),
    },
    transport(opts.provider, call, opts.timeoutMs),
  );
  const choice = body.choices?.[0];
  assertUsable(opts.provider, choice?.finish_reason);
  return choice?.message?.content ?? '';
}
