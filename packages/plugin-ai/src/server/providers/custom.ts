import { ManabloxError } from '@manablox/core';
import type { AiCustomConfig } from '../../sdk.js';
import { assertUsable } from './answer.js';
import { requestBytes, requestJson, transport } from './http.js';
import { openAiChat } from './openai-chat.js';
import type { AiProviderClient, MediaResult, ProviderCall, TextResult } from './types.js';

/**
 * A self-hosted model server. The key is optional.
 * - `openai`: OpenAI-compatible API; base URL includes the version, e.g. `http://ollama:11434/v1`.
 * - `ollama`: native `/api/chat`, for `num_ctx` and JSON format; base URL is the server root.
 */

interface OllamaChatResponse {
  message?: { content?: string };
  done_reason?: string;
}

interface ImagesResponse {
  data?: Array<{ b64_json?: string; url?: string }>;
}

interface ModelsResponse {
  data?: Array<{ id: string }>;
}

interface OllamaTagsResponse {
  models?: Array<{ name: string; model?: string }>;
}

/** OpenAI-style image size per aspect ratio. */
const IMAGE_SIZES: Record<string, string> = {
  '1:1': '1024x1024',
  '4:3': '1152x864',
  '3:4': '864x1152',
  '16:9': '1344x768',
  '9:16': '768x1344',
};

function configOf(call: Pick<ProviderCall, 'custom'>): AiCustomConfig {
  if (!call.custom?.baseUrl) {
    throw ManabloxError.badRequest('plugins.ai.provider.custom.baseUrlInvalid', { baseUrl: '' });
  }
  return call.custom;
}

function endpoint(config: AiCustomConfig, path: string): string {
  return `${config.baseUrl.replace(/\/+$/, '')}${path}`;
}

function headers(apiKey: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  };
}

/** The endpoint's configured timeout, else the call's. */
function deadline(call: Pick<ProviderCall, 'custom' | 'timeoutMs'>): number | undefined {
  const seconds = call.custom?.timeoutSeconds;
  return seconds ? seconds * 1000 : call.timeoutMs;
}

async function openaiText(call: ProviderCall, config: AiCustomConfig): Promise<TextResult> {
  const content = await openAiChat(endpoint(config, '/chat/completions'), call, {
    provider: 'custom',
    headers: headers(call.apiKey),
    tokenField: 'max_tokens',
    maxTokens: call.maxTokens ?? config.maxOutputTokens,
    // Only when configured: some servers reject the key.
    json: Boolean(call.json && config.json),
    timeoutMs: deadline(call),
  });
  return { text: withoutThinking(content) };
}

async function ollamaText(call: ProviderCall, config: AiCustomConfig): Promise<TextResult> {
  const maxTokens = call.maxTokens ?? config.maxOutputTokens;
  const options = {
    ...(config.contextWindow ? { num_ctx: config.contextWindow } : {}),
    ...(maxTokens ? { num_predict: maxTokens } : {}),
  };
  const body = await requestJson<OllamaChatResponse>(
    endpoint(config, '/api/chat'),
    {
      method: 'POST',
      headers: headers(call.apiKey),
      body: JSON.stringify({
        model: call.model,
        stream: false,
        messages: [
          ...(call.system ? [{ role: 'system', content: call.system }] : []),
          { role: 'user', content: call.prompt },
        ],
        ...(call.json && config.json ? { format: 'json' } : {}),
        ...(Object.keys(options).length ? { options } : {}),
      }),
    },
    transport('custom', call, deadline(call)),
  );
  assertUsable('custom', body.done_reason);
  return { text: withoutThinking(body.message?.content ?? '') };
}

/** Strips reasoning models' `<think>...</think>` blocks. */
export function withoutThinking(text: string): string {
  const answer = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!answer) throw ManabloxError.badRequest('plugins.ai.response.empty');
  return answer;
}

export const customProvider: AiProviderClient = {
  kind: 'custom',
  // Upper bound; each endpoint's config narrows it.
  capabilities: ['text', 'image'],

  generateText(call: ProviderCall): Promise<TextResult> {
    const config = configOf(call);
    return config.api === 'ollama' ? ollamaText(call, config) : openaiText(call, config);
  },

  async generateImage(call: ProviderCall): Promise<MediaResult> {
    const config = configOf(call);
    if (config.api !== 'openai') {
      throw ManabloxError.badRequest('plugins.ai.provider.capability.unsupported', {
        provider: 'custom',
        capability: 'image',
      });
    }
    const size = IMAGE_SIZES[call.options.aspectRatio ?? '1:1'] ?? IMAGE_SIZES['1:1'];
    const body = await requestJson<ImagesResponse>(
      endpoint(config, '/images/generations'),
      {
        method: 'POST',
        headers: headers(call.apiKey),
        body: JSON.stringify({
          model: call.model,
          prompt: `${call.system}\n\n${call.prompt}`.trim(),
          n: 1,
          size,
          response_format: 'b64_json',
        }),
      },
      transport('custom', call, deadline(call)),
    );

    const image = body.data?.[0];
    const bytes = image?.b64_json
      ? Buffer.from(image.b64_json, 'base64')
      : image?.url
        ? // URLs are fetched through the guard.
          await requestBytes(
            image.url,
            { headers: headers(call.apiKey) },
            transport('custom', call, deadline(call)),
          )
        : null;
    if (!bytes?.length) throw ManabloxError.badRequest('plugins.ai.response.empty');
    return { body: bytes, mimeType: sniffImage(bytes), filename: 'generated-image' };
  },

  /** Checks the model is on the server, listing what is there if not. */
  async verify(call): Promise<void> {
    const config = configOf(call);
    const available =
      config.api === 'ollama'
        ? ((
            await requestJson<OllamaTagsResponse>(
              endpoint(config, '/api/tags'),
              { headers: headers(call.apiKey) },
              transport('custom', call, deadline(call)),
            )
          ).models?.map((entry) => entry.model ?? entry.name) ?? [])
        : ((
            await requestJson<ModelsResponse>(
              endpoint(config, '/models'),
              { headers: headers(call.apiKey) },
              transport('custom', call, deadline(call)),
            )
          ).data?.map((entry) => entry.id) ?? []);

    const model = call.model;
    // Ollama lists `llama3.1:latest` for a model pulled as `llama3.1`.
    const known = (id: string) => id === model || id === `${model}:latest`;
    if (!model || !available.length || available.some(known)) return;

    throw ManabloxError.badRequest('plugins.ai.provider.model.notFound', {
      provider: 'custom',
      model,
      available: available.join(', '),
      message: `This server has no model "${model}". It has: ${available.slice(0, 30).join(', ')}.`,
    });
  },
};

/** Detects the image type from magic bytes. */
function sniffImage(bytes: Buffer): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF') return 'image/webp';
  return 'image/png';
}
