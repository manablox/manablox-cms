import { defineContentType } from '@manablox/core';
import type {
  WorkflowActionContext,
  WorkflowActionResult,
} from '@manablox/plugin-workflows/define';
import { describe, expect, it } from 'vitest';
import { type AiConfig, aiGenerateAction } from '../src/server/workflow-action.js';

/** The AI service methods the action calls, stubbed. */
type AiPort = Record<string, (input: any) => Promise<unknown>>;

/** `{{ path }}` placeholders read from `context`, as the workflow engine renders them. */
function render(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) => {
    const value = path
      .split('.')
      .reduce<unknown>((at, key) => (at as Record<string, unknown> | undefined)?.[key], context);
    return value === undefined || value === null ? '' : String(value);
  });
}

/** An action context whose instance hands the stub out as the AI plugin's services. */
function contextFor(
  config: AiConfig,
  options: {
    ai?: AiPort;
    nodes?: Record<string, unknown>;
    inputs?: Record<string, unknown>;
  } = {},
): { ctx: WorkflowActionContext<AiConfig> } {
  const context = { content: { id: 'c1', title: 'Launch' }, nodes: options.nodes ?? {} };
  const ctx = {
    config,
    inputs: options.inputs ?? {},
    workflow: { id: 'w', name: 'W', spaceId: 's' },
    render: (template: string) => render(template, context),
    manablox: {
      plugins: {
        get: (id: string) => (id === 'ai' && options.ai ? { ai: options.ai } : undefined),
      },
    },
    signal: new AbortController().signal,
  } as unknown as WorkflowActionContext<AiConfig>;
  return { ctx };
}

const ok = (result: WorkflowActionResult) => {
  if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.kind}`);
  return result;
};

describe('the AI action', () => {
  const ai = (text: string): AiPort => ({
    generateText: async () => ({ text }),
    generateDocument: async () => ({ fields: {}, blocks: {}, grids: {} }),
    startMedia: async () => ({ id: 'g1', status: 'succeeded', assetId: 'a1', error: null }),
    generation: async () => ({ id: 'g1', status: 'succeeded', assetId: 'a1', error: null }),
    available: async () => ({ text: ['anthropic'], image: [], video: [] }),
  });

  it('writes from a prompt that reads an earlier node', async () => {
    const { ctx } = contextFor(
      { ...aiGenerateAction.defaults(), prompt: 'Summarise: {{ nodes.crawl.text }}' },
      { ai: ai('A short summary.'), nodes: { crawl: { text: 'a long page' } } },
    );
    const result = ok(await aiGenerateAction.execute(ctx));
    expect(result.output).toMatchObject({ text: 'A short summary.' });
  });

  it('parses a JSON answer even when the model wraps it in a fence', async () => {
    const { ctx } = contextFor(
      { ...aiGenerateAction.defaults(), prompt: 'Write JSON', format: 'json' } as AiConfig,
      { ai: ai('Sure:\n```json\n{"title":"Hello","tags":["a"]}\n```') },
    );
    const result = ok(await aiGenerateAction.execute(ctx));
    expect((result.output as { json: unknown }).json).toEqual({ title: 'Hello', tags: ['a'] });
  });

  it('asks for JSON alone, and fails with what the model said when it is not JSON', async () => {
    let asked = '';
    const { ctx } = contextFor(
      { ...aiGenerateAction.defaults(), prompt: 'List the articles', format: 'json' } as AiConfig,
      {
        ai: {
          ...ai("I don't see any content to extract articles from."),
          generateText: async (input) => {
            asked = input.prompt;
            return { text: "I don't see any content to extract articles from." };
          },
        },
      },
    );
    await expect(aiGenerateAction.execute(ctx)).rejects.toThrow(
      /did not answer with JSON: "I don't see any content/,
    );
    expect(asked).toMatch(/^List the articles\n\nAnswer with the JSON alone/);
  });

  it('works from what the previous node produced when the prompt quotes no node', async () => {
    const prompts: string[] = [];
    const recording: AiPort = {
      ...ai('ok'),
      generateText: async (input) => {
        prompts.push(input.prompt);
        return { text: 'ok' };
      },
    };
    const inputs = { crawl: { text: 'TypeScript 6 is out', pages: [], count: 1 } };

    const plain = contextFor(
      { ...aiGenerateAction.defaults(), prompt: 'Summarise the news for {{ content.title }}' },
      { ai: recording, inputs },
    );
    await aiGenerateAction.execute(plain.ctx);
    expect(prompts[0]).toMatch(/^Summarise the news for Launch\n\nWork from this material/);
    expect(prompts[0]).toContain('TypeScript 6 is out');

    // A prompt that quotes a node has chosen what the model sees; nothing is added.
    const quoting = contextFor(
      { ...aiGenerateAction.defaults(), prompt: 'Summarise: {{ nodes.crawl.count }}' },
      { ai: recording, inputs, nodes: inputs },
    );
    await aiGenerateAction.execute(quoting.ctx);
    expect(prompts[1]).toBe('Summarise: 1');
  });

  it('writes a whole document, block fields as the values a save takes', async () => {
    const page = defineContentType({
      name: 'page',
      spaceId: 's',
      fields: [
        { name: 'intro', type: 'richtext' },
        { name: 'body', type: 'blocks', settings: { types: [] } },
        {
          name: 'quotes',
          type: 'repeater',
          settings: { fields: [{ name: 'quote', type: 'string' }] },
        },
      ],
    });
    const block = { blockId: 'b1', type: 't1', fields: { text: '<p>Hi</p>' } };
    const item = { itemId: 'i1', fields: { quote: 'Fast' } };
    let asked: { contentTypeId?: string; images?: boolean | undefined; prompt?: string } = {};
    const { ctx } = contextFor(
      {
        ...aiGenerateAction.defaults(),
        capability: 'document',
        typeId: page.id,
        model: 'claude-sonnet-5',
        prompt: 'Write a page about it',
      } as AiConfig,
      {
        ai: {
          ...ai(''),
          generateDocument: async (input) => {
            asked = input;
            return {
              fields: { title: 'TypeScript 6', intro: '<p>New</p>', stray: 'dropped' },
              blocks: { body: [block] },
              grids: { body: { desktop: { columns: 2 } } },
              items: { quotes: [item], stray: [item] },
            };
          },
        },
        inputs: { crawl: { text: 'the news' } },
      },
    );
    (ctx.manablox as { contentTypes: unknown }).contentTypes = {
      tryGet: (id: string) => (id === page.id ? page : undefined),
    };

    const output = ok(await aiGenerateAction.execute(ctx)).output as Record<string, unknown>;
    expect(asked).toMatchObject({
      contentTypeId: page.id,
      images: false,
      model: 'claude-sonnet-5',
    });
    expect(asked.prompt).toContain('the news');
    expect(output).toMatchObject({
      title: 'TypeScript 6',
      typeId: page.id,
      fields: {
        intro: '<p>New</p>',
        body: { grid: { desktop: { columns: 2 } }, blocks: [block] },
        quotes: [item],
      },
    });
    expect(output.fields).not.toHaveProperty('stray');
  });

  it("answers to the plugin's workflow flag and checks the prompt under its own keys", () => {
    expect(aiGenerateAction.feature).toBe('plugins.ai.workflows');
    const problems: string[] = [];
    aiGenerateAction.validate?.(
      { ...aiGenerateAction.defaults(), prompt: ' ' },
      (...rest) => rest,
      (key) => problems.push(key),
    );
    expect(problems).toEqual(['plugins.ai.workflow.promptRequired']);
  });
});
