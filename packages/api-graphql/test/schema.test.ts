import { defineContentType } from '@manablox/core';
import { Manablox } from '@manablox/core/node';
import { ids } from '@manablox/core/testing';
import { builtinFieldTypes } from '@manablox/fields';
import { type GraphQLObjectType, type GraphQLSchema, printSchema } from 'graphql';
import { beforeAll, describe, expect, it } from 'vitest';
import { SchemaCache } from '../src/index.js';
import { buildSchema } from '../src/schema.js';

let manablox: Manablox;
let schema: GraphQLSchema;

const teaser = defineContentType({
  name: 'teaser',
  kind: 'block',
  fields: [
    { name: 'headline', type: 'string' },
    { name: 'image', type: 'asset' },
  ],
});

beforeAll(async () => {
  manablox = new Manablox({
    database: { url: 'postgres://unused' },
    auth: { secret: 'test' },
    fieldTypes: builtinFieldTypes,
    logLevel: 'silent',
    contentTypes: [
      { name: 'teaser', kind: 'block', fields: teaser.fields },
      {
        name: 'blog_post',
        fields: [
          { name: 'body', type: 'richtext' },
          { name: 'read_time', type: 'number', settings: { integer: true }, required: true },
          { name: 'hero', type: 'asset' },
          { name: 'tags', type: 'select', settings: { options: [{ value: 'a' }], multiple: true } },
          { name: 'related', type: 'content', settings: { multiple: true, types: [] } },
          { name: 'components', type: 'blocks', settings: { types: [teaser.id] } },
          { name: 'internal_note', type: 'string', readRoles: ['admin'] },
          { name: 'cta', type: 'link', settings: {} },
        ],
      },
    ],
  });
  await manablox.init();
  schema = buildSchema(manablox);
});

const objectType = (name: string) => schema.getType(name) as GraphQLObjectType;
const fieldType = (typeName: string, fieldName: string) =>
  String(objectType(typeName).getFields()[fieldName]?.type);

describe('generated schema', () => {
  it('gives each content type a real object type with real fields', () => {
    const post = objectType('BlogPost');
    expect(post).toBeDefined();
    expect(Object.keys(post.getFields())).toEqual(
      expect.arrayContaining(['body', 'readTime', 'hero', 'tags', 'related', 'components']),
    );
    expect(printSchema(schema)).not.toContain('ContentFieldUnion');
  });

  it('converts snake_case field names to idiomatic camelCase', () => {
    expect(objectType('BlogPost').getFields().readTime).toBeDefined();
    expect(objectType('BlogPost').getFields().read_time).toBeUndefined();
  });

  it('maps each field type to the right GraphQL type', () => {
    expect(fieldType('BlogPost', 'body')).toBe('JSON');
    expect(fieldType('BlogPost', 'hero')).toBe('Asset');
    // List items are non-null.
    expect(fieldType('BlogPost', 'tags')).toBe('[String!]');
    expect(fieldType('BlogPost', 'related')).toBe('[ContentNode!]');
    // A block list is an object because it carries its grid.
    expect(fieldType('BlogPost', 'components')).toBe('BlockList!');
  });

  it('marks a required field non-null and an optional one nullable, integers as Int', () => {
    expect(fieldType('BlogPost', 'readTime')).toBe('Int!');
    expect(fieldType('BlogPost', 'hero')).toBe('Asset');
  });

  it('omits role-restricted fields from the delivery schema', () => {
    expect(objectType('BlogPost').getFields().internalNote).toBeUndefined();
    expect(printSchema(schema)).not.toContain('internal_note');
  });

  it('generates block types and implements the Block interface', () => {
    const block = objectType('Teaser');
    expect(block).toBeDefined();
    expect(block.getInterfaces().map((i) => i.name)).toContain('Block');
    expect(String(block.getFields().headline?.type)).toBe('String');
  });

  it('gives every content type the ContentNode interface, so a query can stay generic', () => {
    expect(
      objectType('BlogPost')
        .getInterfaces()
        .map((i) => i.name),
    ).toContain('ContentNode');
  });

  it('exposes the routing and navigation entry points', () => {
    const query = schema.getQueryType();
    expect(Object.keys(query?.getFields() ?? {})).toEqual(
      expect.arrayContaining(['contentByPermalink', 'content', 'contentsPage', 'menu', 'asset']),
    );
    expect(query?.getFields().contents).toBeUndefined();
  });

  it('never exposes a user email on the public delivery schema', () => {
    expect(objectType('User').getFields().email).toBeUndefined();
  });

  it('offers per-preset asset URLs rather than a hardcoded thumbnail host', () => {
    expect(objectType('Asset').getFields().variant).toBeDefined();
    expect(objectType('Asset').getFields().url).toBeDefined();
  });
});

describe('schema cache', () => {
  it('rebuilds only when the registry version changes', async () => {
    const cache = new SchemaCache(manablox);
    const first = cache.get();
    expect(cache.get()).toBe(first);

    await manablox.reload([]);
    expect(cache.get()).not.toBe(first);
  });
});

describe('link fields', () => {
  it('is an object with the address resolved, not a bag of JSON', () => {
    expect(fieldType('BlogPost', 'cta')).toBe('Link');
    const link = objectType('Link');
    expect(Object.keys(link.getFields())).toEqual(
      expect.arrayContaining(['mode', 'target', 'label', 'url', 'href', 'content']),
    );
    expect(String(link.getFields().content?.type)).toBe('ContentNode');
    expect(String(link.getFields().href?.type)).toBe('String');
  });
});

/** One schema cannot hold two `Article` types, so it is built per space. */
describe('spaces with the same type name', () => {
  let scoped: Manablox;

  beforeAll(async () => {
    scoped = new Manablox({
      database: { url: 'postgres://unused' },
      auth: { secret: 'test' },
      fieldTypes: builtinFieldTypes,
      logLevel: 'silent',
      // Global, so it belongs to every space's schema.
      contentTypes: [{ name: 'shared', fields: [{ name: 'note', type: 'string' }] }],
    });
    await scoped.init();

    scoped.contentTypes.add(
      defineContentType({
        name: 'article',
        spaceId: ids.space,
        fields: [{ name: 'headline', type: 'string' }],
      }),
    );
    scoped.contentTypes.add(
      defineContentType({
        name: 'article',
        spaceId: ids.otherSpace,
        fields: [{ name: 'strapline', type: 'string' }],
      }),
    );
  });

  it('gives each space its own Article, and the global type to both', () => {
    const a = buildSchema(scoped, { spaceId: ids.space });
    const b = buildSchema(scoped, { spaceId: ids.otherSpace });

    expect(Object.keys((a.getType('Article') as GraphQLObjectType).getFields())).toContain(
      'headline',
    );
    expect(Object.keys((b.getType('Article') as GraphQLObjectType).getFields())).toContain(
      'strapline',
    );
    expect(a.getType('Shared')).toBeDefined();
    expect(b.getType('Shared')).toBeDefined();
  });

  /** Must not throw "Duplicate typename". */
  it('still builds with no space named, keeping one of the two', () => {
    const schema = buildSchema(scoped);
    expect(schema.getType('Article')).toBeDefined();
    expect(schema.getType('Shared')).toBeDefined();
  });

  it('a space that names nothing gets the global types alone', () => {
    const schema = buildSchema(scoped, { spaceId: null });
    expect(schema.getType('Shared')).toBeDefined();
    expect(schema.getType('Article')).toBeUndefined();
  });

  it('drops the least recently used schema past its size, and only that one', () => {
    const cache = new SchemaCache(scoped, {}, 2);
    const one = cache.get(ids.space);
    const two = cache.get(ids.otherSpace);
    expect(cache.get(ids.space)).toBe(one);
    cache.get(null);
    // The other space was used least recently.
    expect(cache.get(ids.space)).toBe(one);
    expect(cache.get(ids.otherSpace)).not.toBe(two);
  });

  it('caches one schema per space and drops them all when the registry changes', () => {
    const cache = new SchemaCache(scoped);
    const first = cache.get(ids.space);

    expect(cache.get(ids.space)).toBe(first);
    expect(cache.get(ids.otherSpace)).not.toBe(first);

    scoped.contentTypes.add(
      defineContentType({
        name: 'later',
        spaceId: ids.space,
        fields: [{ name: 'body', type: 'string' }],
      }),
    );
    expect(cache.get(ids.space)).not.toBe(first);
  });
});
