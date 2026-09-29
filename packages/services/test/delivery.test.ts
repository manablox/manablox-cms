import { createTouchedIds } from '@manablox/cache';
import { ManabloxError } from '@manablox/core';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { blockGridOf, DeliveryReader } from '../src/delivery/index.js';
import { createLoaders } from '../src/loaders.js';
import { createServiceContext, type ServiceContext } from '../src/testing.js';
import { TEST_TYPES } from './helpers/types.js';

let ctx: ServiceContext;
let relatedId: string;

beforeAll(async () => {
  ctx = await createServiceContext('delivery', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
  });
  const related = await ctx.content.create({
    spaceId: ctx.spaceId,
    typeId: ctx.ids.article as string,
    locale: 'en',
    title: 'Related',
    slug: 'related',
    fields: {},
  });
  relatedId = related.id;
  for (let i = 0; i < 20; i++) {
    await ctx.content.create({
      spaceId: ctx.spaceId,
      typeId: ctx.ids.article as string,
      locale: 'en',
      title: `Article ${i}`,
      slug: `article-${i}`,
      fields: { related: related.id, secret: 'hidden' },
    });
  }
});

afterAll(async () => {
  await ctx?.close();
});

/** A draft reader, so rows need no publish. */
const reader = (touched = createTouchedIds()) =>
  new DeliveryReader({
    manablox: ctx.manablox,
    repos: ctx.repos,
    loaders: createLoaders(ctx.repos, false),
    spaceId: ctx.spaceId,
    published: false,
    touched,
  });

describe('DeliveryReader', () => {
  it('lists and resolves references in a fixed number of queries', async () => {
    const touched = createTouchedIds();
    const delivery = reader(touched);
    ctx.resetQueryCount();

    const page = await delivery.list(ctx.spaceId, { type: 'article', limit: 50 });
    const related = await Promise.all(
      page.items.flatMap((row) =>
        typeof row.fields.related === 'string' ? [delivery.byId(row.fields.related)] : [],
      ),
    );

    expect(page.items).toHaveLength(21);
    expect(related.filter(Boolean)).toHaveLength(20);
    // Space for the locale, the list with its count, one batched id read.
    expect(ctx.queryCount()).toBeLessThanOrEqual(4);
    expect(touched.content.has(relatedId)).toBe(true);
    expect([...touched.types]).toEqual([ctx.ids.article]);
    expect(touched.spaceWide).toBe(false);
  });

  it('strips role-gated fields for the anonymous reader', async () => {
    const page = await reader().list(ctx.spaceId, { type: 'article', limit: 5 });
    for (const row of page.items) expect(row.fields).not.toHaveProperty('secret');
  });

  it('returns rows of a type without role-gated fields as loaded', async () => {
    const registry = ctx.manablox.contentTypes;
    const article = registry.get(ctx.ids.article as string);
    const open = { ...article, fields: article.fields.filter((field) => !field.readRoles) };
    const loaders = createLoaders(ctx.repos, false);
    const delivery = new DeliveryReader({
      manablox: ctx.manablox,
      repos: ctx.repos,
      loaders,
      spaceId: ctx.spaceId,
      published: false,
    });
    const tryGet = vi
      .spyOn(registry, 'tryGet')
      .mockImplementation((id) => (id === article.id ? open : undefined));
    try {
      const row = await delivery.byId(relatedId);
      expect(row).toBe(await loaders.content.load(relatedId));
    } finally {
      tryGet.mockRestore();
    }
    const gated = await reader().byId(relatedId);
    expect(gated).not.toBe(await loaders.content.load(relatedId));
    expect(gated?.fields).not.toHaveProperty('secret');
  });

  it('runs no hook when none is registered', async () => {
    const run = vi.spyOn(ctx.manablox.hooks, 'run');
    await reader().list(ctx.spaceId, { type: 'article', limit: 5 });
    await reader().get(relatedId);
    await reader().byPermalink(ctx.spaceId, 'related');
    expect(run).not.toHaveBeenCalled();
    run.mockRestore();
  });

  it('passes every read through the read hooks', async () => {
    const off = ctx.manablox.hooks.on('content:afterRead', (row) =>
      row?.id === relatedId ? null : row,
    );
    try {
      const delivery = reader();
      expect(await delivery.byId(relatedId)).toBeNull();
      const page = await delivery.list(ctx.spaceId, { type: 'article', limit: 50 });
      expect(page.items.map((row) => row.id)).not.toContain(relatedId);
    } finally {
      off();
    }
  });

  it('runs content:beforeRead before single reads, with the space from the row when unscoped', async () => {
    const seen: unknown[] = [];
    const off = ctx.manablox.hooks.on('content:beforeRead', ({ id }, context) => {
      seen.push({ id, actor: context.actor, spaceId: context.spaceId });
      if (id === relatedId) throw ManabloxError.forbidden();
    });
    try {
      const page = await reader().list(ctx.spaceId, { type: 'article', limit: 2 });
      const id = page.items.find((row) => row.id !== relatedId)?.id as string;
      expect((await reader().get(id))?.id).toBe(id);
      const unscoped = new DeliveryReader({
        manablox: ctx.manablox,
        repos: ctx.repos,
        loaders: createLoaders(ctx.repos, false),
        spaceId: null,
        published: false,
      });
      expect((await unscoped.get(id))?.id).toBe(id);
      expect(await unscoped.get(crypto.randomUUID())).toBeNull();
      await expect(reader().byPermalink(ctx.spaceId, 'related')).rejects.toMatchObject({
        key: 'auth.forbidden',
      });
      expect(seen).toEqual([
        { id, actor: null, spaceId: ctx.spaceId },
        { id, actor: null, spaceId: ctx.spaceId },
        { id: relatedId, actor: null, spaceId: ctx.spaceId },
      ]);
    } finally {
      off();
    }
  });

  it('runs content:beforeList before lists and children; a throw refuses them', async () => {
    const parent = await ctx.content.create({
      spaceId: ctx.spaceId,
      typeId: ctx.ids.article as string,
      locale: 'en',
      title: 'Listed parent',
      slug: 'listed-parent',
      fields: {},
    });
    await ctx.content.create({
      spaceId: ctx.spaceId,
      typeId: ctx.ids.article as string,
      locale: 'en',
      parentId: parent.id,
      title: 'Listed child',
      slug: 'listed-child',
      fields: {},
    });
    const seen: unknown[] = [];
    let refuse = false;
    const off = ctx.manablox.hooks.on('content:beforeList', (request, context) => {
      seen.push({ ...request, spaceId: context.spaceId, actor: context.actor });
      if (refuse) throw new Error('no lists');
    });
    try {
      expect((await reader().list(ctx.spaceId, { type: 'article', limit: 5 })).items).toHaveLength(
        5,
      );
      expect(await reader().children(parent.id)).toHaveLength(1);
      expect(seen).toEqual([
        {
          kind: 'list',
          typeIds: [ctx.ids.article],
          locale: 'en',
          spaceId: ctx.spaceId,
          actor: null,
        },
        {
          kind: 'children',
          typeIds: [],
          locale: null,
          parentId: parent.id,
          spaceId: ctx.spaceId,
          actor: null,
        },
      ]);

      refuse = true;
      const page = await reader().list(ctx.spaceId, { type: 'article', limit: 5 });
      expect(page).toMatchObject({ items: [], total: 0 });
      expect(await reader().children(parent.id)).toEqual([]);
      // A single read is not a list.
      expect((await reader().get(parent.id))?.id).toBe(parent.id);

      await expect(
        ctx.content.list({ spaceId: ctx.spaceId }, { limit: 5, offset: 0 }, [], {}),
      ).rejects.toThrow('no lists');
      await expect(ctx.content.treeChildren(ctx.spaceId, 'en', parent.id, {})).rejects.toThrow(
        'no lists',
      );
    } finally {
      off();
    }
  });

  it('keeps a ManabloxError from content:beforeList', async () => {
    const off = ctx.manablox.hooks.on('content:beforeList', () => {
      throw ManabloxError.forbidden();
    });
    try {
      await expect(reader().list(ctx.spaceId, { limit: 5 })).rejects.toMatchObject({
        key: 'auth.forbidden',
      });
    } finally {
      off();
    }
  });

  it('reads a space whose import has not finished as missing', async () => {
    const space = await ctx.repos.spaces.findById(ctx.spaceId);
    await ctx.repos.spaces.setImport(ctx.spaceId, 'importing', null as never);
    try {
      const delivery = reader();
      await expect(delivery.list(ctx.spaceId, { type: 'article' })).rejects.toMatchObject({
        key: 'space.notFound',
      });
      await expect(delivery.byPermalink(ctx.spaceId, 'related')).rejects.toMatchObject({
        key: 'space.notFound',
      });
      expect(await delivery.byId(relatedId)).toBeNull();
      expect(await reader().get(relatedId)).toBeNull();
      expect((await reader().byIds([relatedId])).size).toBe(0);
    } finally {
      await ctx.repos.spaces.setImport(ctx.spaceId, space?.importStatus ?? null, null);
    }
    expect((await reader().byId(relatedId))?.id).toBe(relatedId);
  });

  it('files a permalink miss under the space', async () => {
    const touched = createTouchedIds();
    expect(await reader(touched).byPermalink(ctx.spaceId, '/nowhere/')).toBeNull();
    expect(touched.spaceWide).toBe(true);
  });
});

describe('blockGridOf', () => {
  it('reads a grid only where a breakpoint has columns', () => {
    expect(blockGridOf({ blocks: [] })).toBeNull();
    expect(blockGridOf({ grid: { desktop: { columns: 1 } }, blocks: [] })).toBeNull();
    expect(blockGridOf({ grid: { desktop: { columns: 3 } }, blocks: [] })).toEqual({
      desktop: { columns: 3 },
      tablet: { columns: 3 },
      mobile: { columns: 1 },
    });
  });
});
