import { DefaultControls } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories } from '@manablox/db';
import type { MediaService } from '@manablox/media';
import { describe, expect, it, vi } from 'vitest';
import { AI_CUSTOM_DEFAULTS } from '../src/sdk.js';
import type { AiRepository } from '../src/server/db/index.js';
import { AiService } from '../src/server/services/ai.service.js';

/** The mocked `ai` repository of the test's repositories, as the service's store. */
const storeOf = (repos: Repositories) => (repos as unknown as { ai: AiRepository }).ai;

const provider = {
  id: 'p1',
  spaceId: 's1',
  kind: 'custom',
  slug: 'local',
  label: 'Local',
  enabled: true,
  apiKey: null,
  models: { text: 'llama3.1' },
  systemPrompt: '',
  defaults: {},
  config: { ...AI_CUSTOM_DEFAULTS, baseUrl: 'http://llm:8080/v1', json: true },
};

/** A service over in-memory repositories and a fake chat server answering `answers` in turn. */
function setup(answers: Array<{ content: string; finish_reason?: string }>) {
  const rows: Array<Record<string, unknown>> = [];
  const finished: Array<Record<string, unknown>> = [];
  const sent: Array<Record<string, unknown>> = [];
  const findSpace = vi.fn(async () => ({ id: 's1', name: 'Space', settings: {} }));
  const repos = {
    ai: {
      listProvidersBySpace: async () => [provider],
      createGeneration: async (data: Record<string, unknown>) => {
        const row = { id: `g${rows.length + 1}`, ...data };
        rows.push(row);
        return row;
      },
      finishGeneration: async (id: string, data: Record<string, unknown>) => {
        finished.push({ id, ...data });
        return { ...rows.find((row) => row.id === id), ...data };
      },
    },
    spaces: { findById: findSpace },
    audit: { record: async () => undefined },
  } as unknown as Repositories;
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(init.body as string));
    const answer = answers.shift() ?? { content: '' };
    return Response.json({
      choices: [{ message: { content: answer.content }, finish_reason: answer.finish_reason }],
    });
  });
  const manablox = {
    logger: { warn: () => undefined },
    controls: new DefaultControls(),
  } as unknown as Manablox;
  const service = new AiService(
    manablox,
    repos,
    {} as MediaService,
    {
      secret: 'test-secret',
      fetch: fetch as unknown as typeof globalThis.fetch,
    },
    storeOf(repos),
  );
  return { service, rows, finished, sent, findSpace, controls: manablox.controls };
}

describe('text generation', () => {
  it('records a running row with the resolved length and stores the answer', async () => {
    const { service, rows, finished, sent, findSpace } = setup([{ content: 'Spring is here.' }]);

    const result = await service.generateText({
      spaceId: 's1',
      prompt: 'A teaser',
      length: { words: 8000 },
    });

    expect(result.text).toBe('Spring is here.');
    expect(findSpace).toHaveBeenCalledOnce();
    expect(rows[0]).toMatchObject({
      kind: 'text',
      status: 'running',
      model: 'llama3.1',
      prompt: 'A teaser',
      options: { length: { words: 8000 } },
    });
    expect(finished[0]).toMatchObject({ status: 'succeeded', result: { text: 'Spring is here.' } });
    expect(sent[0]?.max_tokens).toBe(24_800);
  });

  it('counts a finished call as usage, a failed one not', async () => {
    const { service, controls } = setup([
      { content: 'Spring is here.' },
      { content: 'Spring', finish_reason: 'length' },
    ]);
    const consume = vi.spyOn(controls, 'consume');

    await service.generateText({ spaceId: 's1', prompt: 'A teaser' });
    await expect(service.generateText({ spaceId: 's1', prompt: 'Again' })).rejects.toThrow();
    expect(consume.mock.calls).toEqual([['s1', 'plugins.ai.calls', 1]]);
  });

  it('stores a truncated answer as a failure with its key', async () => {
    const { service, finished } = setup([{ content: 'Spring', finish_reason: 'length' }]);

    await expect(service.generateText({ spaceId: 's1', prompt: 'A teaser' })).rejects.toMatchObject(
      { key: 'plugins.ai.response.truncated' },
    );
    expect(finished[0]).toMatchObject({ status: 'failed', error: 'plugins.ai.response.truncated' });
  });

  it('designs with its own system prompt, without loading length settings', async () => {
    const { service, rows, sent, findSpace } = setup([
      { content: '{"name":"x"}' },
      { content: '{"name":"fixed"}' },
    ]);

    const result = await service.designJson({
      spaceId: 's1',
      purpose: 'contentType',
      prompt: 'A blog',
      system: 'You design.',
      check: async (answer) => ({
        value: answer,
        problems: answer.name === 'x' ? ['Name too short.'] : [],
      }),
    });

    expect(result.value).toEqual({ name: 'fixed' });
    expect(result.generationId).toBe('g1');
    expect(findSpace).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ kind: 'design', options: { purpose: 'contentType' } });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({
      max_tokens: 24_000,
      messages: [
        { role: 'system', content: 'You design.' },
        { role: 'user', content: 'A blog' },
      ],
    });
  });
});
