import { ContentTypeRegistry, FieldTypeRegistry } from '@manablox/core';
import {
  createDatabase,
  createRepositories,
  type DatabaseHandle,
  databaseContextOf,
  type Repositories,
} from '@manablox/db';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AiRepository, aiRepos, aiTables } from '../src/server/db/index.js';
import { aiPlugin } from '../src/server/plugin.js';

let database: TestDatabase;
let handle: DatabaseHandle;
const ctx = {} as { repos: Repositories };
let ai: AiRepository;

beforeAll(async () => {
  database = await createTestDatabase('ai', { plugins: [aiPlugin()] });
  handle = await createDatabase({ url: database.url, max: 4 });
  ctx.repos = createRepositories(handle, new ContentTypeRegistry(new FieldTypeRegistry()));
  ai = aiRepos(ctx.repos);
});
afterAll(async () => {
  await handle?.close();
  await database?.drop();
});

let counter = 0;
const freshSpace = async () => {
  const name = `ai_space_${++counter}`;
  return (await ctx.repos.spaces.create({ name, machineName: name, url: 'http://a.test' })).id;
};

const pause = () => new Promise((resolve) => setTimeout(resolve, 3));

describe('ai providers', () => {
  it('inserts a hosted provider with defaults, then patches only the given fields', async () => {
    const spaceId = await freshSpace();
    const created = await ai.upsertProvider({
      spaceId,
      kind: 'openai',
      apiKey: 'cipher',
      apiKeyHint: '1234',
      models: { text: 'gpt' },
    });
    expect(created).toMatchObject({
      slug: '',
      label: '',
      enabled: false,
      apiKey: 'cipher',
      systemPrompt: '',
      defaults: {},
      config: {},
      models: { text: 'gpt' },
    });

    const updated = await ai.upsertProvider({ spaceId, kind: 'openai', enabled: true });
    expect(updated).toMatchObject({ id: created.id, enabled: true, apiKey: 'cipher' });

    // `null` clears the stored key.
    const cleared = await ai.upsertProvider({
      spaceId,
      kind: 'openai',
      apiKey: null,
      apiKeyHint: null,
    });
    expect(cleared).toMatchObject({ id: created.id, apiKey: null, apiKeyHint: null });
    expect(await ai.listProvidersBySpace(spaceId)).toHaveLength(1);
  });

  it('keeps self-hosted providers apart by slug and lists by kind then slug', async () => {
    const spaceId = await freshSpace();
    const other = await freshSpace();
    await ai.upsertProvider({ spaceId, kind: 'custom', slug: 'zed', label: 'Z' });
    await ai.upsertProvider({ spaceId, kind: 'custom', slug: 'alpha', label: 'A' });
    await ai.upsertProvider({ spaceId, kind: 'anthropic' });
    await ai.upsertProvider({ spaceId: other, kind: 'anthropic' });

    const listed = await ai.listProvidersBySpace(spaceId);
    expect(listed.map((row) => `${row.kind}:${row.slug}`)).toEqual([
      'anthropic:',
      'custom:alpha',
      'custom:zed',
    ]);
    expect((await ai.findProviderByKind(spaceId, 'custom', 'zed'))?.label).toBe('Z');
    expect(await ai.findProviderByKind(spaceId, 'custom')).toBeNull();
    expect(await ai.findProviderByKind(spaceId, 'google')).toBeNull();
  });

  it('keeps a given id on insert and finds by id', async () => {
    const spaceId = await freshSpace();
    const id = crypto.randomUUID();
    await ai.upsertProvider({ id, spaceId, kind: 'google' });
    expect((await ai.findProviderById(id))?.kind).toBe('google');
  });

  it('deleteProvider answers whether a row went and keeps its generations', async () => {
    const spaceId = await freshSpace();
    const provider = await ai.upsertProvider({ spaceId, kind: 'openai' });
    const generation = await ai.createGeneration({
      spaceId,
      providerId: provider.id,
      providerKind: 'openai',
      kind: 'text',
      model: 'gpt',
      prompt: 'hi',
    });
    expect(await ai.deleteProvider(provider.id)).toBe(true);
    expect(await ai.deleteProvider(provider.id)).toBe(false);
    expect(await ai.findGenerationById(generation.id)).toMatchObject({
      providerId: null,
      providerKind: 'openai',
    });
  });
});

describe('ai generations', () => {
  it('moves a generation from pending through running to finished', async () => {
    const spaceId = await freshSpace();
    const row = await ai.createGeneration({
      spaceId,
      providerId: null,
      providerKind: 'anthropic',
      kind: 'text',
      model: 'claude',
      prompt: 'Write',
    });
    expect(row).toMatchObject({
      status: 'pending',
      options: {},
      actorId: null,
      result: null,
      finishedAt: null,
    });

    await ai.markRunning(row.id);
    expect((await ai.findGenerationById(row.id))?.status).toBe('running');

    const done = await ai.finishGeneration(row.id, {
      status: 'succeeded',
      result: { text: 'Hello' },
    });
    expect(done).toMatchObject({ status: 'succeeded', result: { text: 'Hello' }, error: null });
    expect(done?.finishedAt).toBeInstanceOf(Date);
  });

  it('records a failure with its key and detail', async () => {
    const spaceId = await freshSpace();
    const row = await ai.createGeneration({
      spaceId,
      providerId: null,
      providerKind: 'openai',
      kind: 'image',
      status: 'running',
      model: 'dall-e',
      prompt: 'cat',
      options: { style: 'photo' },
    });
    expect(row).toMatchObject({ status: 'running', options: { style: 'photo' } });
    const failed = await ai.finishGeneration(row.id, {
      status: 'failed',
      error: 'ai.provider.failed',
      errorDetail: { status: 500 },
    });
    expect(failed).toMatchObject({
      status: 'failed',
      result: null,
      error: 'ai.provider.failed',
      errorDetail: { status: 500 },
    });
  });

  it('finishGeneration of an unknown id returns null', async () => {
    expect(await ai.finishGeneration(crypto.randomUUID(), { status: 'failed' })).toBeNull();
    expect(await ai.findGenerationById(crypto.randomUUID())).toBeNull();
  });

  it('pages a space generations newest first', async () => {
    const spaceId = await freshSpace();
    const other = await freshSpace();
    for (const prompt of ['one', 'two', 'three']) {
      await ai.createGeneration({
        spaceId,
        providerId: null,
        providerKind: 'openai',
        kind: 'text',
        model: 'm',
        prompt,
      });
      await pause();
    }
    await ai.createGeneration({
      spaceId: other,
      providerId: null,
      providerKind: 'openai',
      kind: 'text',
      model: 'm',
      prompt: 'elsewhere',
    });

    const all = await ai.pageGenerationsBySpace(spaceId);
    expect(all.total).toBe(3);
    expect(all.items.map((row) => row.prompt)).toEqual(['three', 'two', 'one']);
    const second = await ai.pageGenerationsBySpace(spaceId, { limit: 1, offset: 1 });
    expect(second).toMatchObject({ total: 3, limit: 1, offset: 1 });
    expect(second.items.map((row) => row.prompt)).toEqual(['two']);
  });
});

describe('ai retention', () => {
  const DAY = 24 * 60 * 60_000;
  const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

  it('prunes finished AI generations of one space by age', async () => {
    const spaceId = await freshSpace();
    const make = (status: 'pending' | 'succeeded' | 'failed') =>
      ai.createGeneration({
        spaceId,
        providerId: null,
        providerKind: 'openai',
        kind: 'text',
        status,
        model: 'm',
        prompt: 'p',
      });
    const rows = [await make('succeeded'), await make('failed'), await make('pending')];
    const { aiGenerations } = aiTables(databaseContextOf(ctx.repos));
    await handle.db
      .update(aiGenerations)
      .set({ createdAt: daysAgo(40) })
      .where(
        inArray(
          aiGenerations.id,
          rows.map((row) => row.id),
        ),
      );
    const age = { spaceId, before: daysAgo(30), limit: 10 };
    expect(await ai.pruneGenerations(age)).toBe(2);
    expect(await ai.findGenerationById(rows[2]?.id as string)).not.toBeNull();
  });
});
