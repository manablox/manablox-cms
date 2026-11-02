import { ManabloxError } from '@manablox/core';
import { describe, expect, it, vi } from 'vitest';
import { anthropicProvider } from '../src/server/providers/anthropic.js';
import { googleProvider, isGeminiImageModel } from '../src/server/providers/google.js';
import { assertCapability, providerClient } from '../src/server/providers/index.js';
import { openaiProvider } from '../src/server/providers/openai.js';

const call = {
  apiKey: 'sk-test',
  model: 'claude-opus-5',
  system: 'You write for a CMS.',
  prompt: 'Write a teaser.',
  options: {},
};

/** Answers the next request with `body`, and records what was sent. */
function respond(body: unknown, init: { status?: number } = {}) {
  const sent: { url?: string; init?: RequestInit } = {};
  vi.stubGlobal('fetch', async (url: string, requestInit: RequestInit) => {
    sent.url = url;
    sent.init = requestInit;
    return new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return sent;
}

describe('the Claude client', () => {
  it('sends the key and the version header, and returns the text blocks joined', async () => {
    const sent = respond({ content: [{ type: 'text', text: 'Spring is here.' }] });

    const result = await anthropicProvider.generateText?.(call);

    expect(result?.text).toBe('Spring is here.');
    expect(sent.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = sent.init?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(sent.init?.body as string);
    expect(body.model).toBe('claude-opus-5');
    expect(body.system).toBe('You write for a CMS.');
    expect(body.messages).toEqual([{ role: 'user', content: 'Write a teaser.' }]);
  });

  it('treats a decline as filtered rather than writing an empty field', async () => {
    respond({ stop_reason: 'refusal', content: [] });
    await expect(anthropicProvider.generateText?.(call)).rejects.toThrow(ManabloxError);
    await expect(anthropicProvider.generateText?.(call)).rejects.toMatchObject({
      key: 'plugins.ai.response.filtered',
    });
  });

  it('refuses an answer cut off at the token limit', async () => {
    respond({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'Spring is' }] });
    await expect(anthropicProvider.generateText?.(call)).rejects.toMatchObject({
      key: 'plugins.ai.response.truncated',
    });
  });

  it('carries the message the provider itself gave out of a rejected request', async () => {
    respond({ error: { message: 'invalid x-api-key' } }, { status: 401 });
    await expect(anthropicProvider.generateText?.(call)).rejects.toMatchObject({
      key: 'plugins.ai.request.failed',
    });
  });
});

describe('the ChatGPT client', () => {
  it('sends the system prompt as its own message and reads the first choice', async () => {
    const sent = respond({ choices: [{ message: { content: 'Spring is here.' } }] });

    const result = await openaiProvider.generateText?.({ ...call, model: 'gpt-5' });

    expect(result?.text).toBe('Spring is here.');
    const body = JSON.parse(sent.init?.body as string);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You write for a CMS.' });
  });

  it('asks for a token ceiling as max_completion_tokens and JSON when wanted', async () => {
    const sent = respond({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] });

    await openaiProvider.generateText?.({ ...call, model: 'gpt-5', json: true, maxTokens: 900 });

    expect(sent.url).toBe('https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(sent.init?.body as string);
    expect(body.max_completion_tokens).toBe(900);
    expect(body.max_tokens).toBeUndefined();
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('refuses a filtered answer and one cut off at the limit', async () => {
    respond({ choices: [{ message: { content: 'Spr' }, finish_reason: 'content_filter' }] });
    await expect(openaiProvider.generateText?.({ ...call, model: 'gpt-5' })).rejects.toMatchObject({
      key: 'plugins.ai.response.filtered',
      details: [{ params: { provider: 'openai', reason: 'content_filter' } }],
    });

    respond({ choices: [{ message: { content: 'Spring is' }, finish_reason: 'length' }] });
    await expect(openaiProvider.generateText?.({ ...call, model: 'gpt-5' })).rejects.toMatchObject({
      key: 'plugins.ai.response.truncated',
    });
  });

  it('sends the caller signal combined with the deadline', async () => {
    const sent = respond({ choices: [{ message: { content: 'ok' } }] });
    const controller = new AbortController();

    await openaiProvider.generateText?.({ ...call, model: 'gpt-5', signal: controller.signal });

    expect(sent.init?.signal).toBeDefined();
    expect(sent.init?.signal).not.toBe(controller.signal);
  });

  it('says so when the answer is empty', async () => {
    respond({ choices: [{ message: { content: '' } }] });
    await expect(openaiProvider.generateText?.({ ...call, model: 'gpt-5' })).rejects.toMatchObject({
      key: 'plugins.ai.response.empty',
    });
  });
});

const pixel = Buffer.from('a tiny picture').toString('base64');

describe('the Google client', () => {
  it('calls a Nano Banana model on generateContent and reads the image part', async () => {
    const sent = respond({
      candidates: [
        {
          finishReason: 'STOP',
          content: {
            parts: [
              { text: 'Here is the picture.' },
              { inlineData: { mimeType: 'image/png', data: pixel } },
            ],
          },
        },
      ],
    });

    const result = await googleProvider.generateImage?.({
      ...call,
      model: 'gemini-3-pro-image-preview',
      prompt: 'a field of tulips',
      options: { aspectRatio: '16:9', resolution: '4K' },
    });

    expect(sent.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent',
    );
    const body = JSON.parse(sent.init?.body as string);
    expect(body.generationConfig.responseModalities).toEqual(['TEXT', 'IMAGE']);
    expect(body.generationConfig.imageConfig).toEqual({ aspectRatio: '16:9', imageSize: '4K' });
    expect(body.contents[0].parts[0].text).toContain('a field of tulips');
    expect(result?.mimeType).toBe('image/png');
    expect(result?.body.toString()).toBe('a tiny picture');
    expect(result?.filename).toBe('a-field-of-tulips');
  });

  it('leaves the size off when none was chosen, which Nano Banana 2 Lite needs', async () => {
    const sent = respond({
      candidates: [{ content: { parts: [{ inlineData: { data: pixel } }] } }],
    });
    await googleProvider.generateImage?.({
      ...call,
      model: 'gemini-3.1-flash-lite-image',
      options: { aspectRatio: '1:1', resolution: '' },
    });
    const body = JSON.parse(sent.init?.body as string);
    expect(body.generationConfig.imageConfig).toEqual({ aspectRatio: '1:1' });
  });

  it('names the reason when the model returns no picture', async () => {
    respond({ promptFeedback: { blockReason: 'SAFETY' }, candidates: [] });
    await expect(
      googleProvider.generateImage?.({ ...call, model: 'gemini-3.1-flash-image' }),
    ).rejects.toMatchObject({ key: 'plugins.ai.response.filtered' });

    respond({ candidates: [{ finishReason: 'RECITATION', content: { parts: [] } }] });
    await expect(
      googleProvider.generateImage?.({ ...call, model: 'gemini-3.1-flash-image' }),
    ).rejects.toMatchObject({ key: 'plugins.ai.response.unusable' });

    respond({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'no' }] } }] });
    await expect(
      googleProvider.generateImage?.({ ...call, model: 'gemini-3.1-flash-image' }),
    ).rejects.toMatchObject({ key: 'plugins.ai.response.empty' });
  });

  it('still calls Imagen on predict, with no image size', async () => {
    const sent = respond({ predictions: [{ bytesBase64Encoded: pixel, mimeType: 'image/jpeg' }] });

    const result = await googleProvider.generateImage?.({
      ...call,
      model: 'imagen-4.0-generate-001',
      options: { aspectRatio: '4:3', resolution: '4K' },
    });

    expect(sent.url).toContain('imagen-4.0-generate-001:predict');
    const body = JSON.parse(sent.init?.body as string);
    expect(body.parameters).toEqual({ sampleCount: 1, aspectRatio: '4:3' });
    expect(result?.mimeType).toBe('image/jpeg');
  });

  it('names the models a key can use when the configured one is not among them', async () => {
    respond({
      models: [
        { name: 'models/gemini-3-pro-image-preview' },
        { name: 'models/imagen-4.0-generate-001' },
        { name: 'models/gemini-2.5-flash' },
      ],
    });

    await expect(
      googleProvider.verify({ apiKey: 'k', model: 'gemini-3-pro-image' }),
    ).rejects.toMatchObject({
      key: 'plugins.ai.provider.model.notFound',
      details: [
        {
          params: {
            model: 'gemini-3-pro-image',
            available: 'gemini-3-pro-image-preview, imagen-4.0-generate-001',
          },
        },
      ],
    });
  });

  it('passes when the key can see the configured model', async () => {
    respond({ models: [{ name: 'models/gemini-3-pro-image' }] });
    await expect(
      googleProvider.verify({ apiKey: 'k', model: 'gemini-3-pro-image' }),
    ).resolves.toBeUndefined();
  });

  it('knows which models answer on which endpoint', () => {
    expect(isGeminiImageModel('gemini-3-pro-image-preview')).toBe(true);
    expect(isGeminiImageModel('gemini-2.5-flash-image')).toBe(true);
    expect(isGeminiImageModel('imagen-4.0-generate-001')).toBe(false);
  });
});

describe('the registry', () => {
  it('refuses a job the provider cannot do', () => {
    expect(() => assertCapability(providerClient('google'), 'text')).toThrow(ManabloxError);
    expect(() => assertCapability(providerClient('anthropic'), 'image')).toThrow(ManabloxError);
    expect(() => assertCapability(providerClient('google'), 'video')).not.toThrow();
  });
});
