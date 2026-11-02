import {
  type AnyUsageMetric,
  DefaultControls,
  type FeatureKey,
  type ResolvedFeature,
  usageExceeded,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories } from '@manablox/db';
import type { MediaService } from '@manablox/media';
import { describe, expect, it, vi } from 'vitest';
import { AI_CUSTOM_DEFAULTS } from '../src/sdk.js';
import type { AiRepository } from '../src/server/db/index.js';
import { AiService } from '../src/server/services/ai.service.js';
import { AiDesignService } from '../src/server/services/design.service.js';

/** The mocked `ai` repository of the test's repositories, as the service's store. */
const storeOf = (repos: Repositories) => (repos as unknown as { ai: AiRepository }).ai;

/** Flags switched off by `<spaceId>:<key>`, or `instance:<key>` for every space. */
class SwitchedControls extends DefaultControls {
  constructor(private readonly off: Set<string>) {
    super();
  }

  override async feature(spaceId: string | null, key: FeatureKey): Promise<ResolvedFeature> {
    const resolved = await super.feature(spaceId, key);
    const enabled = !this.off.has(`instance:${key}`) && !this.off.has(`${spaceId}:${key}`);
    return { ...resolved, enabled };
  }

  /** `<spaceId>:usage.<metric>` in `off` blocks the metric there. */
  override async usageBlocked(spaceId: string | null, metric: AnyUsageMetric) {
    if (!this.off.has(`${spaceId}:usage.${metric}`)) return null;
    return {
      scope: { kind: 'space' as const, id: spaceId as string },
      used: 10,
      max: 10,
      resetsAt: '2999-01-01T00:00:00.000Z',
    };
  }

  override async assertUsage(spaceId: string | null, metric: AnyUsageMetric): Promise<void> {
    const block = await this.usageBlocked(spaceId, metric);
    if (block) throw usageExceeded(metric, block.scope, block.used, block.max, block.resetsAt);
  }
}

const provider = (spaceId: string) => ({
  id: `p-${spaceId}`,
  spaceId,
  kind: 'custom',
  slug: 'local',
  label: 'Local',
  enabled: true,
  apiKey: null,
  models: { text: 'llama3.1', image: 'img' },
  systemPrompt: '',
  defaults: {},
  config: {
    ...AI_CUSTOM_DEFAULTS,
    baseUrl: 'http://llm:8080/v1',
    capabilities: ['text', 'image'],
    json: true,
  },
});

function setup(...off: string[]) {
  const repos = {
    ai: {
      listProvidersBySpace: async (spaceId: string) => [provider(spaceId)],
      createGeneration: async (data: Record<string, unknown>) => ({ id: 'g1', ...data }),
      finishGeneration: async (id: string, data: Record<string, unknown>) => ({ id, ...data }),
    },
    spaces: { findById: async (id: string) => ({ id, name: 'Space', settings: {} }) },
    audit: { record: async () => undefined },
  } as unknown as Repositories;
  const fetch = vi.fn(async () => Response.json({ choices: [{ message: { content: 'Hello.' } }] }));
  const manablox = {
    logger: { warn: () => undefined },
    controls: new SwitchedControls(new Set(off)),
  } as unknown as Manablox;
  const ai = new AiService(
    manablox,
    repos,
    {} as MediaService,
    {
      secret: 'test-secret',
      fetch: fetch as unknown as typeof globalThis.fetch,
    },
    storeOf(repos),
  );
  return { ai, design: new AiDesignService(manablox, ai), fetch };
}

const refused = (promise: Promise<unknown>, feature: string) =>
  expect(promise).rejects.toMatchObject({
    key: 'control.feature',
    status: 403,
    details: [{ params: { feature } }],
  });

describe('AI feature flags', () => {
  it('`plugins.ai` off at the instance refuses every generation before a provider is called', async () => {
    const { ai, fetch } = setup('instance:plugins.ai');
    await refused(ai.generateText({ spaceId: 's1', prompt: 'Hi' }), 'plugins.ai');
    await refused(
      ai.startMedia({ spaceId: 's1', prompt: 'A cat', capability: 'image' }),
      'plugins.ai',
    );
    await refused(
      ai.designJson({
        spaceId: 's1',
        purpose: 'x',
        prompt: 'x',
        system: 'x',
        check: async (value) => ({ value, problems: [] }),
      }),
      'plugins.ai',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('`plugins.ai` off in one space leaves the other spaces generating', async () => {
    const { ai } = setup('s1:plugins.ai');
    await refused(ai.generateText({ spaceId: 's1', prompt: 'Hi' }), 'plugins.ai');
    expect((await ai.generateText({ spaceId: 's2', prompt: 'Hi' })).text).toBe('Hello.');
  });

  it('`plugins.ai.images` and `plugins.ai.video` refuse only their media', async () => {
    const { ai } = setup('s1:plugins.ai.images', 's1:plugins.ai.video');
    await refused(
      ai.startMedia({ spaceId: 's1', prompt: 'A cat', capability: 'image' }),
      'plugins.ai.images',
    );
    await refused(
      ai.startMedia({ spaceId: 's1', prompt: 'A cat', capability: 'video' }),
      'plugins.ai.video',
    );
    expect((await ai.generateText({ spaceId: 's1', prompt: 'Hi' })).text).toBe('Hello.');
  });

  it('`plugins.ai.designModels` refuses type and template designs', async () => {
    const { design, fetch } = setup('s1:plugins.ai.designModels');
    const request = { spaceId: 's1', prompt: 'A blog' };
    await refused(design.designContentTypes(request), 'plugins.ai.designModels');
    await refused(design.designTemplate(request), 'plugins.ai.designModels');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('`plugins.ai.designSpace` is read at the instance for designs of a new space', async () => {
    const { design } = setup('instance:plugins.ai.designSpace');
    await refused(
      design.designContentTypes({ spaceId: 's1', prompt: 'A shop', forNewSpace: true }),
      'plugins.ai.designSpace',
    );
    // A design for the space itself is not a new-space design.
    const models = setup('instance:plugins.ai.designSpace', 's1:plugins.ai.designModels');
    await refused(
      models.design.designContentTypes({ spaceId: 's1', prompt: 'A shop' }),
      'plugins.ai.designModels',
    );
  });
});

describe('AI usage limit', () => {
  it('refuses text and media generation while plugins.ai.calls is used up, before any provider call', async () => {
    const { ai, fetch } = setup('s1:usage.plugins.ai.calls');
    const used = (promise: Promise<unknown>) =>
      expect(promise).rejects.toMatchObject({
        key: 'control.usage',
        status: 429,
        details: [{ params: { metric: 'plugins.ai.calls', scope: 'space:s1', used: 10, max: 10 } }],
      });
    await used(ai.generateText({ spaceId: 's1', prompt: 'Hi' }));
    await used(ai.startMedia({ spaceId: 's1', prompt: 'A cat', capability: 'image' }));
    await used(
      ai.designJson({
        spaceId: 's1',
        purpose: 'x',
        prompt: 'x',
        system: 'x',
        check: async (value) => ({ value, problems: [] }),
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
    expect((await ai.generateText({ spaceId: 's2', prompt: 'Hi' })).text).toBe('Hello.');
  });
});
