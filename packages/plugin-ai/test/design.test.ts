import type { AnyFieldType, ContentTypeDefinition } from '@manablox/core';
import { defineContentType } from '@manablox/core';
import { stableId } from '@manablox/core/node';
import { describe, expect, it } from 'vitest';
import {
  type ContentTypeDesignContext,
  composeContentTypeDesignPrompt,
  describeExisting,
  readContentTypeDesign,
} from '../src/server/services/design/content-types.js';
import { readTemplateDesign } from '../src/server/services/design/template.js';

/** A strict Standard Schema stub: known keys only, and `types` must be uuids. */
function schema(keys: Record<string, 'string' | 'number' | 'uuid' | 'uuids' | 'list'>) {
  const uuid = /^[0-9a-f-]{36}$/;
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate(value: unknown) {
        const input = (value ?? {}) as Record<string, unknown>;
        const issues: Array<{ message: string; path: string[] }> = [];
        for (const [key, entry] of Object.entries(input)) {
          const kind = keys[key];
          const ok =
            kind === 'string'
              ? typeof entry === 'string'
              : kind === 'number'
                ? typeof entry === 'number'
                : kind === 'uuid'
                  ? typeof entry === 'string' && uuid.test(entry)
                  : kind === 'uuids'
                    ? Array.isArray(entry) && entry.every((id) => uuid.test(String(id)))
                    : kind === 'list'
                      ? Array.isArray(entry)
                      : false;
          if (!ok) issues.push({ message: 'invalid', path: [key] });
        }
        return issues.length ? { issues } : { value: input };
      },
    },
    toJSONSchema: () => ({ type: 'object', properties: keys }),
  };
}

const fieldType = (name: string, settings: Parameters<typeof schema>[0], nested = false) =>
  ({
    name,
    label: name,
    settingsSchema: schema(settings),
    valueSchema: () => schema({}),
    nested,
  }) as unknown as AnyFieldType;

const FIELD_TYPES = [
  fieldType('string', { max: 'number' }),
  fieldType('richtext', {}),
  fieldType('asset', { accept: 'string' }),
  fieldType('blocks', { types: 'uuids' }, true),
  fieldType('content', { types: 'uuids' }),
  {
    ...fieldType('repeater', { fields: 'list', min: 'number', max: 'number' }),
    subFields: () => [],
  } as AnyFieldType,
];

const existingHero = defineContentType({
  name: 'hero',
  kind: 'block',
  spaceId: 'space',
  fields: [{ name: 'heading', type: 'string' }],
}) as ContentTypeDefinition;
const existingArticle = defineContentType({
  name: 'article',
  spaceId: 'space',
  fields: [{ name: 'body', type: 'richtext' }],
}) as ContentTypeDefinition;

const context = (overrides: Partial<ContentTypeDesignContext> = {}): ContentTypeDesignContext => ({
  fieldTypes: FIELD_TYPES,
  existing: [existingHero, existingArticle],
  scope: 'any',
  ...overrides,
});

describe('designing content types', () => {
  it('shows the model the field types, their settings and what exists', () => {
    const prompt = composeContentTypeDesignPrompt('A recipe site', context({ icons: ['doc'] }));
    expect(prompt).toContain('"blocks" (blocks)');
    expect(prompt).toContain('"types":"uuids"');
    expect(prompt).toContain('"hero" (block, "Hero"): heading: string');
    expect(prompt).toContain('"icon" is one of: doc');
    expect(prompt.endsWith('The request: A recipe site')).toBe(true);
  });

  it('reads a design into a plan, references by name, settings checked', async () => {
    const { value, problems } = await readContentTypeDesign(
      {
        types: [
          {
            name: 'recipe_step',
            kind: 'block',
            fields: [{ name: 'text', type: 'richtext', admin: { width: 40, zone: 'x' } }],
          },
          {
            name: 'recipe',
            kind: 'content',
            label: 'Recipe',
            hasSlug: true,
            isPublishable: false,
            requiresApproval: true,
            fields: [
              { name: 'intro', type: 'string', settings: { max: 300 }, localized: true },
              { name: 'steps', type: 'blocks', settings: { types: ['recipe_step', 'hero'] } },
              { name: 'related', type: 'content', settings: { types: ['article'] } },
              { name: 'slug', type: 'string' },
            ],
          },
        ],
        notes: 'Steps are blocks.',
      },
      context(),
    );

    expect(problems).toEqual([]);
    expect(value.notes).toBe('Steps are blocks.');
    expect(value.reused.sort()).toEqual(['article', 'hero']);
    const [step, recipe] = value.plan.types;
    // Width snaps to an offered one; unknown zone becomes main.
    expect(step?.fields[0]?.admin).toEqual({ zone: 'main', width: 33 });
    // No approval without publishing; the reserved slug field is dropped.
    expect(recipe).toMatchObject({ hasSlug: true, isPublishable: false, requiresApproval: false });
    expect(recipe?.fields.map((field) => field.name)).toEqual(['intro', 'steps', 'related']);
    // References are checked as ids and returned as names.
    expect(recipe?.fields[1]?.settings).toEqual({ types: ['recipe_step', 'hero'] });
  });

  it('lists what it cannot use, and leaves it out of the plan', async () => {
    const { value, problems } = await readContentTypeDesign(
      {
        types: [
          { name: 'hero', kind: 'block', fields: [] },
          { name: 'Bad Name', kind: 'content', fields: [] },
          {
            name: 'page',
            kind: 'content',
            fields: [
              { name: 'map', type: 'geo' },
              { name: 'sections', type: 'blocks', settings: { types: ['missing'] } },
              { name: 'wrong', type: 'blocks', settings: { types: ['article'] } },
              { name: 'size', type: 'string', settings: { max: 'big' } },
              { name: 'ok', type: 'string' },
            ],
          },
        ],
      },
      context(),
    );

    expect(value.plan.types.map((type) => type.name)).toEqual(['page']);
    expect(value.plan.types[0]?.fields.map((field) => field.name)).toEqual(['ok']);
    expect(problems).toHaveLength(6);
    expect(problems.join('\n')).toMatch(/"hero" already exists/);
    expect(problems.join('\n')).toMatch(/"geo", which does not exist/);
    expect(problems.join('\n')).toMatch(/"missing", which is neither designed/);
    expect(problems.join('\n')).toMatch(/must be a block type/);
    expect(problems.join('\n')).toMatch(/settings of the field "size"/);
  });

  it('holds a block-only design to block types', async () => {
    const { value, problems } = await readContentTypeDesign(
      {
        types: [
          { name: 'quote', kind: 'block', fields: [{ name: 'text', type: 'string' }] },
          { name: 'page', kind: 'content', fields: [] },
        ],
      },
      context({ scope: 'block' }),
    );
    expect(value.plan.types.map((type) => type.name)).toEqual(['quote']);
    expect(problems[0]).toMatch(/only block types were asked for/);
  });
  it('reads a databag with only its publishing flags, as a relation target', async () => {
    const { value, problems } = await readContentTypeDesign(
      {
        types: [
          {
            name: 'category',
            kind: 'data',
            hasSlug: true,
            isPublishable: false,
            fields: [{ name: 'title_de', type: 'string' }],
          },
          {
            name: 'post',
            kind: 'content',
            fields: [{ name: 'category', type: 'content', settings: { types: ['category'] } }],
          },
        ],
      },
      context(),
    );
    expect(problems).toEqual([]);
    expect(value.plan.types[0]).toMatchObject({ kind: 'data', isPublishable: false });
    expect(value.plan.types[0]).not.toHaveProperty('hasSlug');
    expect(value.plan.types[1]?.fields[0]?.settings).toEqual({ types: ['category'] });
  });
});

describe('designing a repeater', () => {
  it('tells the model how to design one', () => {
    const prompt = composeContentTypeDesignPrompt('A team page', context());
    expect(prompt).toContain('A "repeater" field holds a list of items');
    expect(prompt).toContain('"repeater" (repeater)');
  });

  it('checks sub-fields like fields, block references included', async () => {
    const { value, problems } = await readContentTypeDesign(
      {
        types: [
          {
            name: 'team_page',
            kind: 'content',
            fields: [
              {
                name: 'members',
                type: 'repeater',
                settings: {
                  max: 12,
                  fields: [
                    { name: 'name', type: 'string', required: true, admin: { width: 48 } },
                    { name: 'Bad Name', type: 'string' },
                    { name: 'map', type: 'geo' },
                    { name: 'size', type: 'string', settings: { max: 'big' } },
                    { name: 'intro', type: 'blocks', settings: { types: ['hero'] } },
                    {
                      name: 'links',
                      type: 'repeater',
                      settings: {
                        fields: [
                          { name: 'url', type: 'string' },
                          {
                            name: 'deeper',
                            type: 'repeater',
                            settings: { fields: [{ name: 'x', type: 'string' }] },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
              {
                name: 'broken',
                type: 'repeater',
                settings: {
                  fields: [{ name: 'hero', type: 'blocks', settings: { types: ['article'] } }],
                },
              },
              { name: 'empty', type: 'repeater', settings: { fields: [] } },
            ],
          },
        ],
      },
      context(),
    );

    const fields = value.plan.types[0]?.fields ?? [];
    expect(fields.map((field) => field.name)).toEqual(['members']);
    expect(fields[0]?.settings).toEqual({
      max: 12,
      fields: [
        {
          name: 'name',
          label: 'Name',
          type: 'string',
          required: true,
          settings: {},
          admin: { width: 50 },
        },
        {
          name: 'intro',
          label: 'Intro',
          type: 'blocks',
          settings: { types: ['hero'] },
          admin: { width: 100 },
        },
        {
          name: 'links',
          label: 'Links',
          type: 'repeater',
          settings: {
            fields: [
              { name: 'url', label: 'Url', type: 'string', settings: {}, admin: { width: 100 } },
            ],
          },
          admin: { width: 100 },
        },
      ],
    });
    expect(value.reused).toEqual(['hero']);
    const all = problems.join('\n');
    expect(all).toMatch(/sub-field "Bad Name" of the field "members" .*machine name/);
    expect(all).toMatch(/sub-field "map" .*"geo", which does not exist/);
    expect(all).toMatch(/settings of the sub-field "size"/);
    expect(all).toMatch(/sub-field "deeper" .*nests repeaters too deep/);
    expect(all).toMatch(/field "broken" .*"fields\.0\.types", but that must be a block type/);
    expect(all).toMatch(/field "empty" .*no usable sub-fields/);
  });

  it('describes an existing repeater with its sub-fields', () => {
    const faq = defineContentType({
      name: 'faq',
      spaceId: 'space',
      fields: [
        {
          name: 'quotes',
          type: 'repeater',
          settings: {
            fields: [
              { name: 'quote', type: 'string' },
              { name: 'photo', type: 'asset' },
              { name: 'cta', type: 'blocks', settings: { types: [existingHero.id] } },
            ],
          },
        },
      ],
    }) as ContentTypeDefinition;
    expect(describeExisting(faq, [faq, existingHero])).toContain(
      'quotes: repeater {quote: string, photo: asset, cta: blocks [hero]}',
    );
  });
});

describe('designing a template', () => {
  it('lays out existing and new blocks, the new ones under the ids they will have', async () => {
    const { value, problems } = await readTemplateDesign(
      {
        blockTypes: [
          { name: 'pricing', kind: 'block', fields: [{ name: 'plan', type: 'string' }] },
          { name: 'unused', kind: 'block', fields: [{ name: 'x', type: 'string' }] },
        ],
        title: 'Product launch',
        grid: { columns: 2 },
        blocks: [
          {
            block: 'hero',
            fields: { heading: 'Meet it' },
            layout: { column: 1, row: 1, columnSpan: 2 },
          },
          { block: 'pricing', fields: { plan: 'Pro', stray: 'dropped' } },
          { block: 'ghost', fields: {} },
        ],
      },
      { ...context({ scope: 'block' }), spaceId: 'space-1' },
    );

    expect(value.title).toBe('Product launch');
    expect(value.plan.types.map((type) => type.name)).toEqual(['pricing']);
    expect(value.blocks.map((block) => block.type)).toEqual([
      existingHero.id,
      stableId('contentType', 'space-1:pricing'),
    ]);
    expect(value.blocks[1]?.fields).toEqual({ plan: 'Pro' });
    expect(value.grid?.desktop).toEqual({ columns: 2 });
    expect(problems).toEqual([
      'The block "ghost" is neither an existing block type nor one designed under "blockTypes".',
    ]);
  });

  it('fills the repeaters of a new block type with sample items', async () => {
    const { value, problems } = await readTemplateDesign(
      {
        blockTypes: [
          {
            name: 'faq',
            kind: 'block',
            fields: [
              {
                name: 'entries',
                type: 'repeater',
                settings: { fields: [{ name: 'question', type: 'string' }] },
              },
            ],
          },
        ],
        blocks: [{ block: 'faq', fields: { entries: [{ question: 'Why?' }] } }],
      },
      { ...context({ scope: 'block' }), spaceId: 'space-1' },
    );
    expect(problems).toEqual([]);
    expect(value.blocks[0]?.fields).toEqual({
      entries: [{ itemId: expect.any(String), fields: { question: 'Why?' } }],
    });
  });
});
