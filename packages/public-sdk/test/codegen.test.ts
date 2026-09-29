import { describe, expect, it } from 'vitest';
import { generateTypes } from '../src/codegen.js';
import type { ContentModel } from '../src/types.js';

const model: ContentModel = {
  types: [
    {
      name: 'teaser',
      label: 'Teaser',
      kind: 'block',
      fields: [
        {
          name: 'headline',
          type: 'string',
          required: true,
          list: false,
          kind: 'scalar',
          scalar: 'String',
        },
        {
          name: 'image',
          type: 'asset',
          required: false,
          list: false,
          kind: 'ref',
          target: 'asset',
        },
      ],
    },
    {
      name: 'blog_post',
      label: 'Blog post',
      kind: 'content',
      fields: [
        {
          name: 'summary',
          type: 'string',
          required: false,
          list: false,
          kind: 'scalar',
          scalar: 'String',
        },
        {
          name: 'read_time',
          type: 'number',
          required: true,
          list: false,
          kind: 'scalar',
          scalar: 'Int',
        },
        {
          name: 'featured',
          type: 'boolean',
          required: true,
          list: false,
          kind: 'scalar',
          scalar: 'Boolean',
        },
        {
          name: 'body',
          type: 'richtext',
          required: false,
          list: false,
          kind: 'scalar',
          scalar: 'JSON',
        },
        {
          name: 'tags',
          type: 'select',
          required: false,
          list: true,
          kind: 'scalar',
          scalar: 'String',
        },
        { name: 'hero', type: 'asset', required: false, list: false, kind: 'ref', target: 'asset' },
        { name: 'author', type: 'user', required: false, list: false, kind: 'ref', target: 'user' },
        {
          name: 'components',
          type: 'blocks',
          required: false,
          list: true,
          kind: 'block',
          blockTypes: ['teaser'],
        },
        {
          name: 'faq',
          type: 'repeater',
          required: false,
          list: true,
          kind: 'items',
          fields: [
            {
              name: 'question',
              type: 'string',
              required: true,
              list: false,
              kind: 'scalar',
              scalar: 'String',
            },
            {
              name: 'icon',
              type: 'asset',
              required: false,
              list: false,
              kind: 'ref',
              target: 'asset',
            },
            {
              name: 'promo',
              type: 'block',
              required: false,
              list: false,
              kind: 'block',
              blockTypes: ['teaser'],
            },
            {
              name: 'notes',
              type: 'repeater',
              required: false,
              list: true,
              kind: 'items',
              fields: [
                {
                  name: 'text',
                  type: 'string',
                  required: false,
                  list: false,
                  kind: 'scalar',
                  scalar: 'String',
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const output = generateTypes(model, { source: 'https://cms.example.com' });

describe('generateTypes', () => {
  it('names interfaces the way the GraphQL schema does', () => {
    expect(output).toContain('export interface BlogPost extends ContentNode {');
    expect(output).toContain('export interface Teaser extends Block {');
  });

  it('discriminates on the type name so a union narrows', () => {
    expect(output).toContain('type: "blog_post";');
    expect(output).toContain('export type Content = BlogPost;');
  });

  it('maps scalars to TypeScript types', () => {
    expect(output).toContain('read_time: number;');
    expect(output).toContain('featured: boolean;');
    expect(output).toContain('body?: unknown | null;');
    expect(output).toContain('tags?: Array<string>;');
  });

  it('marks optional fields optional and nullable', () => {
    expect(output).toContain('summary?: string | null;');
  });

  /** A relation is an id unless expanded. */
  it('types a relation as id-or-object', () => {
    expect(output).toContain('hero?: string | Asset | null;');
    expect(output).toContain(
      'author?: string | { id: string; name: string; image: string | null } | null;',
    );
  });

  it('types a block list as a union of its allowed block types', () => {
    expect(output).toContain('components?: BlocksValue<Teaser>;');
  });

  it('types a repeater as a list of items built from its sub-fields, recursively', () => {
    expect(output).toContain(
      'faq?: Array<{ itemId: string; fields: { question: string; icon?: string | Asset | null; ' +
        'promo?: Teaser | null; notes?: Array<{ itemId: string; fields: { text?: string | null; } }>; } }>;',
    );
  });

  it('emits a name-to-interface map for typed list calls', () => {
    expect(output).toContain('export interface ContentByName {');
    expect(output).toContain('blog_post: BlogPost;');
  });

  it('marks the output as generated and records where it came from', () => {
    expect(output.startsWith('// Generated by `manablox-sdk types`. Do not edit.')).toBe(true);
    expect(output).toContain('// Source: https://cms.example.com');
  });

  it('applies a prefix when asked, to avoid collisions', () => {
    const prefixed = generateTypes(model, { prefix: 'Cms' });
    expect(prefixed).toContain('export interface CmsBlogPost extends ContentNode {');
    expect(prefixed).toContain('components?: BlocksValue<CmsTeaser>;');
  });

  it('quotes a field name that is not a valid identifier', () => {
    const odd = generateTypes({
      types: [
        {
          name: 'page',
          label: 'Page',
          kind: 'content',
          fields: [
            {
              name: 'og:title',
              type: 'string',
              required: true,
              list: false,
              kind: 'scalar',
              scalar: 'String',
            },
          ],
        },
      ],
    });
    expect(odd).toContain('"og:title": string;');
  });
});
