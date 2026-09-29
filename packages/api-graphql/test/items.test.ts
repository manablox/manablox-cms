import { defineContentType, definePlugin } from '@manablox/core';
import { Manablox } from '@manablox/core/node';
import { builtinFieldTypes } from '@manablox/fields';
import { type GraphQLObjectType, type GraphQLSchema, graphql } from 'graphql';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Builder } from '../src/builder.js';
import type { GraphQLContext } from '../src/context.js';
import { buildSchema } from '../src/schema.js';

const PAGE_ID = '11111111-1111-4111-8111-111111111111';
const ASSET_ID = '22222222-2222-4222-8222-222222222222';
const TARGET_ID = '33333333-3333-4333-8333-333333333333';
const ITEM_ID = '44444444-4444-4444-8444-444444444444';
const BLOCK_ID = '55555555-5555-4555-8555-555555555555';

const teaser = defineContentType({
  name: 'teaser',
  kind: 'block',
  fields: [{ name: 'headline', type: 'string' }],
});

let manablox: Manablox;
let schema: GraphQLSchema;

/** Block data at `ext.acme`, delivered as `tone` where it has a name. */
const acme = definePlugin({
  name: 'acme',
  blocks: {
    publicApi: {
      field: 'tone',
      serialize: (value) => ((value as { name?: string }).name ? value : undefined),
    },
    graphql: {
      type: (builder: Builder) =>
        builder.objectRef<{ name: string }>('AcmeTone').implement({
          fields: (t) => ({ name: t.exposeString('name') }),
        }),
    },
  },
});

beforeAll(async () => {
  manablox = new Manablox({
    database: { url: 'postgres://unused' },
    auth: { secret: 'test' },
    fieldTypes: builtinFieldTypes,
    logLevel: 'silent',
    plugins: [acme],
    contentTypes: [
      { name: 'teaser', kind: 'block', fields: teaser.fields },
      {
        name: 'landing_page',
        fields: [
          { name: 'sections', type: 'blocks', settings: { types: [teaser.id] } },
          {
            name: 'feature_list',
            type: 'repeater',
            settings: {
              fields: [
                { name: 'title', type: 'string', required: true },
                { name: 'icon', type: 'asset' },
                { name: 'more', type: 'content', settings: { types: [] } },
                { name: 'promo', type: 'block', settings: { types: [teaser.id] } },
                {
                  name: 'bullets',
                  type: 'repeater',
                  settings: { fields: [{ name: 'text', type: 'string' }] },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  await manablox.init();
  schema = buildSchema(manablox);
});

const fieldType = (typeName: string, fieldName: string) =>
  String((schema.getType(typeName) as GraphQLObjectType).getFields()[fieldName]?.type);

describe('repeater fields', () => {
  it('is a list of a per-field item type named after the type and field', () => {
    expect(fieldType('LandingPage', 'featureList')).toBe('[LandingPageFeatureListItem!]!');
    expect(fieldType('LandingPageFeatureListItem', 'itemId')).toBe('ID!');
    expect(fieldType('LandingPageFeatureListItem', 'title')).toBe('String!');
    expect(fieldType('LandingPageFeatureListItem', 'icon')).toBe('Asset');
    expect(fieldType('LandingPageFeatureListItem', 'more')).toBe('ContentNode');
    expect(fieldType('LandingPageFeatureListItem', 'promo')).toBe('Block');
    expect(fieldType('LandingPageFeatureListItem', 'bullets')).toBe(
      '[LandingPageFeatureListBulletsItem!]!',
    );
    expect(fieldType('LandingPageFeatureListBulletsItem', 'text')).toBe('String');
  });

  it('resolves refs and blocks inside items like top-level fields', async () => {
    const typeId = manablox.contentTypes.getByName('landing_page').id;
    const page = {
      id: PAGE_ID,
      typeId,
      fields: {
        feature_list: [
          {
            itemId: ITEM_ID,
            fields: {
              title: 'Fast',
              icon: ASSET_ID,
              more: TARGET_ID,
              promo: { blockId: BLOCK_ID, type: teaser.id, fields: { headline: 'Hi' } },
              bullets: [{ itemId: ITEM_ID, fields: { text: 'one' } }],
            },
          },
        ],
      },
    };
    const target = { id: TARGET_ID, typeId, title: 'Target', fields: {} };
    const reader = {
      get: async () => page,
      assets: async (ids: string[]) =>
        new Map(ids.map((id) => [id, { id, name: 'icon.svg' }] as const)),
      byIds: async (ids: string[]) =>
        new Map(ids.filter((id) => id === TARGET_ID).map((id) => [id, target] as const)),
    };
    const result = await graphql({
      schema,
      source: `{ content(id: "${PAGE_ID}") { ... on LandingPage { featureList {
        itemId title icon { id name } more { id title }
        promo { blockId ... on Teaser { headline } }
        bullets { text }
      } } } }`,
      contextValue: { reader } as unknown as GraphQLContext,
    });
    expect(result.errors).toBeUndefined();
    expect(result.data?.content).toEqual({
      featureList: [
        {
          itemId: ITEM_ID,
          title: 'Fast',
          icon: { id: ASSET_ID, name: 'icon.svg' },
          more: { id: TARGET_ID, title: 'Target' },
          promo: { blockId: BLOCK_ID, headline: 'Hi' },
          bullets: [{ text: 'one' }],
        },
      ],
    });
  });
});

describe('plugin block data', () => {
  const block = (id: string, extra: Record<string, unknown> = {}) => ({
    blockId: id,
    type: teaser.id,
    fields: { headline: id },
    ...extra,
  });
  const page = {
    id: PAGE_ID,
    typeId: '',
    fields: {
      sections: {
        blocks: [
          block(BLOCK_ID, { ext: { acme: { name: 'dark' }, other: { x: 1 } } }),
          block(ITEM_ID),
          block(TARGET_ID, { ext: { acme: {} } }),
        ],
      },
    },
  };
  const query = () =>
    graphql({
      schema,
      source: `{ content(id: "${PAGE_ID}") { ... on LandingPage { sections { blocks {
        blockId tone { name }
      } } } } }`,
      contextValue: {
        reader: {
          get: async () => ({
            ...page,
            typeId: manablox.contentTypes.getByName('landing_page').id,
          }),
        },
        manablox,
        spaceId: 's1',
      } as unknown as GraphQLContext,
    });

  it('adds the field to blocks, set where the plugin delivers something, else null', async () => {
    const result = await query();
    expect(result.errors).toBeUndefined();
    expect(result.data?.content).toEqual({
      sections: {
        blocks: [
          { blockId: BLOCK_ID, tone: { name: 'dark' } },
          { blockId: ITEM_ID, tone: null },
          { blockId: TARGET_ID, tone: null },
        ],
      },
    });
    expect(fieldType('Teaser', 'tone')).toBe('AcmeTone');
  });

  it('is null where the plugin is off for the space', async () => {
    const off = vi
      .spyOn(manablox.controls, 'feature')
      .mockResolvedValue({ enabled: false } as never);
    const result = await query();
    off.mockRestore();
    const blocks = (result.data?.content as { sections: { blocks: { tone: unknown }[] } }).sections
      .blocks;
    expect(blocks.map((entry) => entry.tone)).toEqual([null, null, null]);
  });
});

describe('item type names', () => {
  it('suffixes an item type name a content type already holds', async () => {
    const clashing = new Manablox({
      database: { url: 'postgres://unused' },
      auth: { secret: 'test' },
      fieldTypes: builtinFieldTypes,
      logLevel: 'silent',
      contentTypes: [
        {
          name: 'faq',
          fields: [
            {
              name: 'entries',
              type: 'repeater',
              settings: { fields: [{ name: 'q', type: 'string' }] },
            },
          ],
        },
        { name: 'faq_entries_item', fields: [{ name: 'note', type: 'string' }] },
      ],
    });
    await clashing.init();
    const built = buildSchema(clashing);
    expect(String((built.getType('Faq') as GraphQLObjectType).getFields().entries?.type)).toBe(
      '[FaqEntriesItem2!]!',
    );
    expect(built.getType('FaqEntriesItem')).toBeDefined();
  });
});
