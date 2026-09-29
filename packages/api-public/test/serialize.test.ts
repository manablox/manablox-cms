import { definePlugin } from '@manablox/core';
import { Manablox } from '@manablox/core/node';
import { ids } from '@manablox/core/testing';
import { builtinFieldTypes } from '@manablox/fields';
import { createLoaders, DeliveryReader } from '@manablox/services';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { PublicContext } from '../src/context.js';
import { parseExpand, serializeContents } from '../src/serialize.js';

/** A test plugin's block data, delivered as `design` when it has a variant or a style. */
const decoDelivery = {
  field: 'design',
  serialize: (value: unknown) => {
    const design = value as { variant?: string; style?: Record<string, unknown> } | null;
    return design?.variant || Object.keys(design?.style ?? {}).length ? design : undefined;
  },
};

let manablox: Manablox;
let loads: string[];
/** Repository queries made by `filter` relations, in order. */
let queries: Array<{ kind: string; filter: unknown; pagination: unknown }>;

beforeAll(async () => {
  manablox = new Manablox({
    database: { url: 'postgres://unused' },
    auth: { secret: 'test' },
    fieldTypes: builtinFieldTypes,
    logLevel: 'silent',
    plugins: [definePlugin({ name: 'deco', blocks: { publicApi: decoDelivery } })],
    contentTypes: [
      {
        name: 'teaser',
        kind: 'block',
        fields: [
          { name: 'headline', type: 'string' },
          { name: 'image', type: 'asset' },
        ],
      },
      {
        name: 'templated',
        fields: [{ name: 'layout', type: 'template', settings: {} }],
      },
      {
        name: 'landing',
        fields: [{ name: 'body', type: 'blocks', settings: {} }],
      },
      {
        name: 'linked',
        fields: [{ name: 'cta', type: 'link', settings: {} }],
      },
      {
        name: 'listing',
        fields: [
          {
            name: 'latest',
            type: 'content',
            settings: { multiple: true, selection: 'filter', limit: 2, sortBy: 'title' },
          },
          {
            name: 'gallery',
            type: 'asset',
            settings: { multiple: true, selection: 'filter', accept: ['image/'], limit: 2 },
          },
        ],
      },
      {
        name: 'faq',
        fields: [
          {
            name: 'entries',
            type: 'repeater',
            settings: {
              fields: [
                { name: 'question', type: 'string' },
                { name: 'icon', type: 'asset' },
                { name: 'more', type: 'content', settings: { types: [] } },
                { name: 'cta', type: 'link', settings: {} },
                { name: 'promo', type: 'block', settings: { types: [] } },
                {
                  name: 'notes',
                  type: 'repeater',
                  settings: { fields: [{ name: 'image', type: 'asset' }] },
                },
              ],
            },
          },
        ],
      },
      {
        name: 'page',
        fields: [
          { name: 'summary', type: 'string' },
          { name: 'hero', type: 'asset' },
          { name: 'related', type: 'content', settings: { multiple: true, types: [] } },
          { name: 'secret', type: 'string', readRoles: ['admin'] },
        ],
      },
    ],
  });
  await manablox.init();
});

const asset = (id: string) => ({
  id,
  spaceId: ids.space,
  filename: 'x.jpg',
  name: 'x',
  mimeType: 'image/jpeg',
  size: 1,
  width: 10,
  height: 10,
  alt: 'alt',
  title: null,
});

const related = (id: string) => ({
  id,
  spaceId: ids.space,
  typeId: manablox.contentTypes.getByName('page').id,
  title: 'Related',
  slug: 'related',
  permalink: 'related',
  locale: 'en',
  parentId: null,
  publishedAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
  fields: {},
});

function context(): PublicContext {
  loads = [];
  queries = [];
  const loader = <T>(build: (id: string) => T | null, label: string) => ({
    load: async (id: string) => {
      loads.push(`${label}:1`);
      return build(id);
    },
    loadMany: async (ids: string[]) => {
      // One entry per batch.
      loads.push(`${label}:${ids.length}`);
      return ids.map(build);
    },
  });

  // Only the list queries `filter` relations use.
  const repos = {
    content: {
      page: async (filter: unknown, pagination: { limit: number; offset: number }) => {
        queries.push({ kind: 'content', filter, pagination });
        return { items: [related(ids.doc), related(ids.otherDoc)], total: 2, ...pagination };
      },
    },
    assets: {
      page: async (filter: unknown, pagination: { limit: number; offset: number }) => {
        queries.push({ kind: 'asset', filter, pagination });
        return { items: [asset(ids.asset)], total: 1, ...pagination };
      },
    },
    tags: {
      listByLocalizations: async () => new Map(),
      listByAssets: async () => new Map(),
    },
    spaces: { listByIds: async () => [{ id: ids.space, defaultLocale: 'en' }] },
  } as never;
  const loaders = {
    // The real relation loader, over the fake list queries.
    relationQuery: createLoaders(repos, true).relationQuery,
    asset: loader((id) => asset(id), 'asset'),
    user: loader(() => null, 'user'),
    publishedContent: loader(
      (id) =>
        id === ids.template
          ? {
              id,
              typeId: manablox.contentTypes.getByName('template').id,
              title: 'Footer',
              permalink: null,
              locale: 'en',
              fields: {
                blocks: {
                  grid: { desktop: { columns: 2 } },
                  blocks: [
                    {
                      blockId: 'tb1',
                      type: manablox.contentTypes.getByName('teaser').id,
                      fields: { headline: 'From the template', image: ids.asset },
                      ext: { deco: { variant: 'compact' } },
                    },
                  ],
                },
              },
            }
          : {
              id,
              typeId: manablox.contentTypes.getByName('page').id,
              title: 'Related',
              permalink: 'related',
              locale: 'en',
              fields: { summary: 'About the related page', hero: ids.asset },
            },
      'content',
    ),
    content: loader(() => null, 'draft'),
    children: loader(() => [], 'children'),
    space: { load: async () => ({ id: ids.space, defaultLocale: 'en' }) },
  } as never;

  return {
    manablox,
    repos,
    menus: {} as never,
    media: { urlFor: (row: { id: string }) => `https://cdn.test/${row.id}` } as never,
    loaders,
    reader: new DeliveryReader({ manablox, repos, loaders, spaceId: ids.space, published: true }),
    spaceId: ids.space,
  };
}

const row = (over: Record<string, unknown> = {}) =>
  ({
    id: 'c1',
    spaceId: ids.space,
    typeId: manablox.contentTypes.getByName('page').id,
    title: 'A page',
    slug: 'a-page',
    permalink: 'a-page',
    locale: 'en',
    parentId: null,
    publishedAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    fields: { summary: 'hello', hero: ids.asset, related: [ids.doc], secret: 'nope' },
    ...over,
  }) as never;

describe('serializer', () => {
  it('returns fields as a plain map keyed by field name', async () => {
    const [result] = await serializeContents([row()], context(), parseExpand(undefined));
    expect(result?.fields).toEqual({ summary: 'hello', hero: ids.asset, related: [ids.doc] });
    expect(result?.type).toBe('page');
    expect(result?.publishedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('omits role-gated fields', async () => {
    const [result] = await serializeContents([row()], context(), parseExpand(undefined));
    expect(result?.fields).not.toHaveProperty('secret');
  });

  it('inlines only the relations named in expand', async () => {
    const [result] = await serializeContents([row()], context(), parseExpand('hero'));
    expect(result?.fields.hero).toMatchObject({
      id: ids.asset,
      url: `https://cdn.test/${ids.asset}`,
    });
    // Not requested, so still ids.
    expect(result?.fields.related).toEqual([ids.doc]);
  });

  it('loads each relation target in one batch however many rows there are', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => row({ id: `c${i}` }));
    await serializeContents(rows, context(), parseExpand('hero,related'));

    expect(loads.filter((entry) => entry.startsWith('asset:'))).toEqual(['asset:1']);
    expect(loads.filter((entry) => entry.startsWith('content:'))).toEqual(['content:1']);
  });

  it('walks into blocks', async () => {
    const teaser = manablox.contentTypes.getByName('teaser');
    const withBlocks = row({
      typeId: manablox.contentTypes.getByName('page').id,
      fields: {
        summary: 's',
        hero: null,
        related: [],
        blocks: [{ blockId: 'b1', type: teaser.id, fields: { headline: 'Hi', image: ids.asset } }],
      },
    });

    // `page` declares no blocks field, so none may appear.
    const [result] = await serializeContents([withBlocks], context(), parseExpand(undefined));
    expect(result?.fields).not.toHaveProperty('blocks');
  });

  it('delivers a block design only where one is set', async () => {
    const teaser = manablox.contentTypes.getByName('teaser');
    const design = { variant: 'dark', style: { background: 'color:primary', hide: ['mobile'] } };
    const block = (blockId: string, extra: Record<string, unknown> = {}) => ({
      blockId,
      type: teaser.id,
      fields: { headline: blockId, image: null },
      ...extra,
    });
    const landing = row({
      typeId: manablox.contentTypes.getByName('landing').id,
      fields: {
        body: {
          blocks: [
            block('designed', { ext: { deco: design, other: { a: 1 } } }),
            block('plain'),
            block('empty', { ext: { deco: { style: {} } } }),
          ],
        },
      },
    });

    const [result] = await serializeContents([landing], context(), parseExpand(undefined));
    const blocks = (result?.fields.body as { blocks: Array<Record<string, unknown>> }).blocks;
    expect(blocks[0]?.design).toEqual(design);
    expect(blocks[0]?.fields).not.toHaveProperty('design');
    // Raw plugin data never leaves; only a plugin's delivered field does.
    expect(Object.keys(blocks[0] ?? {})).toEqual(['blockId', 'type', 'fields', 'design']);
    expect(blocks[1]).not.toHaveProperty('design');
    expect(blocks[2]).not.toHaveProperty('design');

    // The plugin off for the space: nothing delivered.
    const off = vi
      .spyOn(manablox.controls, 'feature')
      .mockResolvedValue({ enabled: true } as never);
    off.mockResolvedValueOnce({ enabled: false } as never);
    const [hidden] = await serializeContents([landing], context(), parseExpand(undefined));
    off.mockRestore();
    const first = (hidden?.fields.body as { blocks: Array<Record<string, unknown>> }).blocks[0];
    expect(first).not.toHaveProperty('design');
  });

  it('inlines a content relation as a summary, not a recursive expansion', async () => {
    const [result] = await serializeContents([row()], context(), parseExpand('related'));
    const [related] = result?.fields.related as Array<Record<string, unknown>>;
    expect(related).toEqual({
      id: ids.doc,
      type: 'page',
      title: 'Related',
      permalink: 'related',
      locale: 'en',
      tags: [],
    });
    expect(related).not.toHaveProperty('fields');
  });

  it('adds the related fields with their assets inlined for the site', async () => {
    const [result] = await serializeContents(
      [row()],
      { ...context(), relatedFields: true },
      parseExpand('related'),
    );
    const [related] = result?.fields.related as Array<Record<string, unknown>>;
    expect(related?.fields).toMatchObject({
      summary: 'About the related page',
      hero: { id: ids.asset, url: expect.any(String) },
      // Its own relations stay ids.
      related: null,
    });
  });
});

describe('a template field', () => {
  const templated = (over: Record<string, unknown> = {}) =>
    ({
      id: 't-page',
      spaceId: ids.space,
      typeId: manablox.contentTypes.getByName('templated').id,
      title: 'Uses a template',
      slug: 'uses-a-template',
      permalink: 'uses-a-template',
      locale: 'en',
      parentId: null,
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
      fields: { layout: ids.template },
      ...over,
    }) as never;

  it("delivers the template's blocks in place of the reference", async () => {
    const [result] = await serializeContents([templated()], context(), parseExpand(undefined));
    const layout = result?.fields.layout as { grid: unknown; blocks: Array<{ type: string }> };

    expect(layout.blocks).toHaveLength(1);
    expect(layout.blocks[0]).toMatchObject({
      blockId: 'tb1',
      type: 'teaser',
      design: { variant: 'compact' },
    });
    expect(layout.grid).toMatchObject({ desktop: { columns: 2 } });
  });

  it('loads the template without being asked to expand anything', async () => {
    await serializeContents([templated()], context(), parseExpand(undefined));
    expect(loads.filter((entry) => entry.startsWith('content:'))).toEqual(['content:1']);
  });

  it("expands the relations inside the template's blocks", async () => {
    const [result] = await serializeContents([templated()], context(), parseExpand('image'));
    const layout = result?.fields.layout as {
      blocks: Array<{ fields: Record<string, unknown> }>;
    };
    expect(layout.blocks[0]?.fields.image).toMatchObject({ id: ids.asset });
  });

  it('delivers an empty block list when the template is not published', async () => {
    const [result] = await serializeContents(
      [templated({ fields: { layout: null } })],
      context(),
      parseExpand(undefined),
    );
    expect(result?.fields.layout).toEqual({ grid: null, blocks: [] });
  });
});

describe('parseExpand', () => {
  it('accepts a comma list and ignores blanks', () => {
    expect([...parseExpand('hero, author,,')]).toEqual(['hero', 'author']);
    expect(parseExpand(undefined).size).toBe(0);
  });
});

describe('link fields', () => {
  const linked = (cta: unknown) =>
    row({ typeId: manablox.contentTypes.getByName('linked').id, fields: { cta } });

  it('resolves an internal link to the document permalink', async () => {
    const [result] = await serializeContents(
      [linked({ mode: 'internal', contentId: ids.doc, url: null, target: '_blank', label: null })],
      context(),
      parseExpand(undefined),
    );
    expect(result?.fields.cta).toMatchObject({
      mode: 'internal',
      href: 'related',
      target: '_blank',
    });
    expect(result?.fields.cta).not.toHaveProperty('content');
  });

  it('hands an external link back as it is', async () => {
    const [result] = await serializeContents(
      [
        linked({
          mode: 'external',
          contentId: null,
          url: 'https://example.com',
          target: '_self',
          label: 'Home',
        }),
      ],
      context(),
      parseExpand(undefined),
    );
    expect(result?.fields.cta).toMatchObject({ href: 'https://example.com', label: 'Home' });
  });

  it('inlines the document when the field is expanded, and stays null when there is none', async () => {
    const [expanded] = await serializeContents(
      [linked({ mode: 'internal', contentId: ids.doc, url: null, target: '_self', label: null })],
      context(),
      parseExpand('cta'),
    );
    expect(expanded?.fields.cta).toMatchObject({ content: { id: ids.doc, type: 'page' } });

    const [empty] = await serializeContents([linked(null)], context(), parseExpand('cta'));
    expect(empty?.fields.cta).toBeNull();
  });
});

describe('filter relations', () => {
  const listing = () => row({ typeId: manablox.contentTypes.getByName('listing').id, fields: {} });

  it('resolves the field query rather than reading the stored value', async () => {
    const [result] = await serializeContents([listing()], context(), parseExpand(undefined));

    expect(result?.fields.latest).toEqual([ids.doc, ids.otherDoc]);
    expect(result?.fields.gallery).toEqual([ids.asset]);
    expect(queries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'content', pagination: { limit: 2, offset: 0 } }),
        expect.objectContaining({
          kind: 'asset',
          filter: { spaceId: ids.space, mimeType: 'image/' },
          pagination: { limit: 2, offset: 0 },
        }),
      ]),
    );
  });

  it('runs one query per field however many documents carry it', async () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      row({ id: `l${i}`, typeId: manablox.contentTypes.getByName('listing').id, fields: {} }),
    );
    await serializeContents(rows, context(), parseExpand(undefined));
    expect(queries).toHaveLength(2);
  });

  it('inlines the matches when the field is expanded', async () => {
    const [result] = await serializeContents([listing()], context(), parseExpand('latest'));
    expect(result?.fields.latest).toMatchObject([{ id: ids.doc }, { id: ids.otherDoc }]);
  });
});

describe('repeater fields', () => {
  const faq = () =>
    row({
      typeId: manablox.contentTypes.getByName('faq').id,
      fields: {
        entries: [
          {
            itemId: 'i1',
            fields: {
              question: 'Why?',
              icon: ids.asset,
              more: ids.doc,
              cta: {
                mode: 'internal',
                contentId: ids.doc,
                url: null,
                target: '_self',
                label: null,
              },
              promo: {
                blockId: 'b1',
                type: manablox.contentTypes.getByName('teaser').id,
                fields: { headline: 'Hi', image: ids.asset },
              },
              notes: [{ itemId: 'n1', fields: { image: ids.asset } }],
            },
          },
        ],
      },
    });

  it('delivers items with their fields built like top-level fields', async () => {
    const [result] = await serializeContents([faq()], context(), parseExpand(undefined));
    expect(result?.fields.entries).toEqual([
      {
        itemId: 'i1',
        fields: {
          question: 'Why?',
          icon: ids.asset,
          more: ids.doc,
          cta: expect.objectContaining({ mode: 'internal', href: 'related' }),
          promo: {
            grid: null,
            blocks: [
              { blockId: 'b1', type: 'teaser', fields: { headline: 'Hi', image: ids.asset } },
            ],
          },
          notes: [{ itemId: 'n1', fields: { image: ids.asset } }],
        },
      },
    ]);
  });

  it('expands relations named inside items, nested ones and blocks included', async () => {
    const [result] = await serializeContents([faq()], context(), parseExpand('icon,more,image'));
    const [entry] = result?.fields.entries as Array<{ fields: Record<string, unknown> }>;
    expect(entry?.fields.icon).toMatchObject({
      id: ids.asset,
      url: `https://cdn.test/${ids.asset}`,
    });
    expect(entry?.fields.more).toMatchObject({ id: ids.doc, type: 'page' });
    expect(entry?.fields.promo).toMatchObject({
      blocks: [{ fields: { image: { id: ids.asset } } }],
    });
    expect(entry?.fields.notes).toMatchObject([{ fields: { image: { id: ids.asset } } }]);
    expect(loads.filter((load) => load.startsWith('asset:'))).toEqual(['asset:1']);
  });
});
