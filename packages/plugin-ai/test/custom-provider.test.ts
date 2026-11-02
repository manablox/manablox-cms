import { describe, expect, it, vi } from 'vitest';
import { AI_CUSTOM_DEFAULTS, type AiCustomConfig } from '../src/sdk.js';
import { customProvider, withoutThinking } from '../src/server/providers/custom.js';
import { normaliseCustomConfig } from '../src/server/services/ai.service.js';

const config = (overrides: Partial<AiCustomConfig> = {}): AiCustomConfig => ({
  ...AI_CUSTOM_DEFAULTS,
  baseUrl: 'http://ollama:11434/v1',
  ...overrides,
});

const call = (overrides: Partial<AiCustomConfig> = {}, extra: Record<string, unknown> = {}) => ({
  apiKey: '',
  model: 'llama3.1',
  system: 'You write for a CMS.',
  prompt: 'Write a teaser.',
  options: {},
  custom: config(overrides),
  ...extra,
});

/** Answers every request with `body`, recording each one. */
function respond(body: unknown) {
  const sent: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  });
  return sent;
}

describe('a self-hosted provider', () => {
  it('speaks chat completions, without a key when it has none', async () => {
    const sent = respond({ choices: [{ message: { content: 'Spring is here.' } }] });

    const result = await customProvider.generateText?.(call({}, { json: true, maxTokens: 900 }));

    expect(result?.text).toBe('Spring is here.');
    expect(sent[0]?.url).toBe('http://ollama:11434/v1/chat/completions');
    const headers = sent[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    const body = JSON.parse(sent[0]?.init.body as string);
    expect(body).toMatchObject({
      model: 'llama3.1',
      stream: false,
      response_format: { type: 'json_object' },
      max_tokens: 900,
    });
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You write for a CMS.' });
  });

  it('leaves JSON mode off for a server the card says cannot keep to it', async () => {
    const sent = respond({ choices: [{ message: { content: '{}' } }] });
    await customProvider.generateText?.({ ...call({ json: false }), json: true, apiKey: 'k' });
    const body = JSON.parse(sent[0]?.init.body as string);
    expect(body.response_format).toBeUndefined();
    expect((sent[0]?.init.headers as Record<string, string>).authorization).toBe('Bearer k');
  });

  it('leaves out an empty system prompt', async () => {
    const sent = respond({ choices: [{ message: { content: 'ok' } }] });
    await customProvider.generateText?.(call({}, { system: '' }));
    const body = JSON.parse(sent[0]?.init.body as string);
    expect(body.messages).toEqual([{ role: 'user', content: 'Write a teaser.' }]);
  });

  it('refuses a filtered or truncated answer from either API', async () => {
    respond({ choices: [{ message: { content: 'x' }, finish_reason: 'content_filter' }] });
    await expect(customProvider.generateText?.(call())).rejects.toMatchObject({
      key: 'plugins.ai.response.filtered',
    });

    respond({ choices: [{ message: { content: 'Spring is' }, finish_reason: 'length' }] });
    await expect(customProvider.generateText?.(call())).rejects.toMatchObject({
      key: 'plugins.ai.response.truncated',
    });

    respond({ message: { content: 'Spring is' }, done_reason: 'length' });
    await expect(
      customProvider.generateText?.(call({ api: 'ollama', baseUrl: 'http://ollama:11434' })),
    ).rejects.toMatchObject({
      key: 'plugins.ai.response.truncated',
      details: [{ params: { provider: 'custom' } }],
    });
  });

  it("speaks Ollama's own chat, with the context window and a JSON format", async () => {
    const sent = respond({ message: { content: '<think>hmm</think>\n{"title": "x"}' } });

    const result = await customProvider.generateText?.({
      ...call({ api: 'ollama', baseUrl: 'http://ollama:11434', contextWindow: 32768 }),
      json: true,
    });

    expect(result?.text).toBe('{"title": "x"}');
    expect(sent[0]?.url).toBe('http://ollama:11434/api/chat');
    const body = JSON.parse(sent[0]?.init.body as string);
    expect(body).toMatchObject({ format: 'json', options: { num_ctx: 32768 }, stream: false });
  });

  it('draws through an OpenAI-style image endpoint', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const sent = respond({ data: [{ b64_json: png.toString('base64') }] });

    const result = await customProvider.generateImage?.({
      ...call({ capabilities: ['image'] }),
      options: { aspectRatio: '16:9' },
    });

    expect(sent[0]?.url).toBe('http://ollama:11434/v1/images/generations');
    expect(JSON.parse(sent[0]?.init.body as string)).toMatchObject({ size: '1344x768', n: 1 });
    expect(result?.mimeType).toBe('image/png');
    expect(result?.body.equals(png)).toBe(true);
  });

  it('names the models the server has when the configured one is missing', async () => {
    respond({ data: [{ id: 'qwen3:8b' }, { id: 'mistral' }] });
    await expect(customProvider.verify(call())).rejects.toMatchObject({
      key: 'plugins.ai.provider.model.notFound',
      details: [{ params: expect.objectContaining({ available: 'qwen3:8b, mistral' }) }],
    });
  });

  it('accepts an Ollama model pulled without a tag', async () => {
    respond({ models: [{ name: 'llama3.1:latest', model: 'llama3.1:latest' }] });
    await expect(
      customProvider.verify(call({ api: 'ollama', baseUrl: 'http://ollama:11434' })),
    ).resolves.toBeUndefined();
  });
});

describe('a self-hosted card', () => {
  it('fills every gap and keeps each value in range', () => {
    expect(
      normaliseCustomConfig({
        baseUrl: 'http://gpu-box:8000/v1/',
        capabilities: ['text', 'video' as never],
        maxOutputTokens: 4096.4,
        timeoutSeconds: 99_999,
      }),
    ).toEqual({
      baseUrl: 'http://gpu-box:8000/v1',
      api: 'openai',
      capabilities: ['text'],
      json: true,
      maxOutputTokens: 4096,
      timeoutSeconds: 3600,
    });
  });

  it('refuses an address that is not http(s)', () => {
    expect(() => normaliseCustomConfig({ baseUrl: 'file:///etc/passwd' })).toThrow();
  });

  it('strips a reasoning model scratchpad, and refuses an answer that was only that', () => {
    expect(withoutThinking('<think>a\nb</think>Answer')).toBe('Answer');
    expect(() => withoutThinking('<think>only</think>')).toThrow();
  });
});
