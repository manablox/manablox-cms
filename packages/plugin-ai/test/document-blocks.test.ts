import type { ContentTypeDefinition, FieldDefinition } from '@manablox/core';
import { ContentTypeRegistry, FieldTypeRegistry } from '@manablox/core';
import { fixedId, ids } from '@manablox/core/testing';
import { describe, expect, it } from 'vitest';
import {
  blockFieldSpecs,
  blocksFromAnswer,
  imageFieldSpecs,
  isMultipleAsset,
  itemsFromAnswer,
  readImages,
  repeaterFieldSpecs,
} from '../src/server/document-plan.js';
import { composeDocumentPrompt } from '../src/server/prompt.js';
import { planDocument, readDocumentAnswer } from '../src/server/services/ai/assembly.js';

const field = (
  name: string,
  type: string,
  settings: Record<string, unknown> = {},
): FieldDefinition => ({
  id: `field-${name}`,
  name,
  label: name[0]?.toUpperCase() + name.slice(1),
  type,
  settings,
  required: false,
  localized: false,
  unique: false,
  admin: { zone: 'main', position: 0, width: 100 },
});

const type = (
  id: string,
  name: string,
  kind: 'content' | 'block',
  fields: FieldDefinition[],
): ContentTypeDefinition => ({
  id,
  name,
  label: name[0]?.toUpperCase() + name.slice(1),
  kind,
  spaceId: ids.space,
  hasSlug: kind === 'content',
  isPublishable: true,
  isVisibleInTree: true,
  canBeVisibleInMenu: true,
  requiresApproval: false,
  isSystem: false,
  fields,
  source: 'runtime',
});

const TEASER = type(fixedId(21), 'teaser', 'block', [
  field('headline', 'string', { max: 60 }),
  field('text', 'richtext'),
  field('image', 'asset'),
]);
const QUOTE = type(fixedId(22), 'quote', 'block', [field('quote', 'string')]);
const DIVIDER = type(fixedId(23), 'divider', 'block', []);

function registryWith(types: ContentTypeDefinition[]): ContentTypeRegistry {
  const registry = new ContentTypeRegistry(new FieldTypeRegistry());
  registry.setAll(types);
  return registry;
}

const PAGE = type(ids.type, 'page', 'content', [
  field('teaser', 'string'),
  field('components', 'blocks', { types: [TEASER.id, QUOTE.id, DIVIDER.id], max: 6 }),
  field('hero', 'block', { type: TEASER.id }),
]);

describe('blockFieldSpecs', () => {
  const specs = blockFieldSpecs(PAGE, registryWith([PAGE, TEASER, QUOTE, DIVIDER]));

  it('finds both kinds of block field, with the types each may hold', () => {
    expect(specs.map((spec) => spec.name)).toEqual(['components', 'hero']);
    expect(specs[0]?.single).toBe(false);
    expect(specs[0]?.max).toBe(6);
    expect(specs[0]?.types.map((entry) => entry.name)).toEqual(['teaser', 'quote', 'divider']);
    expect(specs[1]?.single).toBe(true);
    expect(specs[1]?.types.map((entry) => entry.name)).toEqual(['teaser']);
  });

  it('offers only the text fields of a block; an asset is not something to write', () => {
    expect(specs[0]?.types[0]?.fields.map((entry) => entry.name)).toEqual(['headline', 'text']);
  });

  it('leaves out a field whose block types this instance does not have', () => {
    const orphaned = type(ids.otherType, 'page', 'content', [
      field('components', 'blocks', { types: [ids.missing] }),
    ]);
    expect(blockFieldSpecs(orphaned, registryWith([TEASER]))).toEqual([]);
  });
});

describe('composeDocumentPrompt with blocks', () => {
  const specs = blockFieldSpecs(PAGE, registryWith([PAGE, TEASER, QUOTE, DIVIDER]));
  const prompt = composeDocumentPrompt({
    instruction: 'a page about a bookshop',
    styles: {},
    typeLabel: 'Page',
    fields: [field('teaser', 'string')],
    locale: 'en',
    blockFields: specs,
    images: [{ name: 'cover', label: 'Cover' }],
    aspectRatios: ['1:1', '16:9'],
  });

  it('names every block on offer and the fields it takes', () => {
    expect(prompt).toContain('"teaser" (Teaser)');
    expect(prompt).toContain('"headline"');
    expect(prompt).toContain('under 60 characters');
    expect(prompt).toContain('"divider" (Divider) - nothing to fill in');
    expect(prompt).toContain('at most 6');
    expect(prompt).toContain('exactly one block');
    expect(prompt).toContain('"block": "<one of the names above>"');
  });

  it('asks for a grid and a placement per block', () => {
    expect(prompt).toContain('Lay "components" out on a grid');
    expect(prompt).toContain('"columnSpan"');
    expect(prompt).toContain('no two may overlap');
    expect(prompt).toContain('"grid": {"columns": N}');
  });

  it('asks for a brief per picture rather than a picture', () => {
    expect(prompt).toContain('picture "cover": Cover');
    expect(prompt).toContain('picture "image": Image');
    expect(prompt).toContain('described, not drawn');
    expect(prompt).toContain('1:1, 16:9');
  });
});

describe('blocksFromAnswer', () => {
  const [components, hero] = blockFieldSpecs(PAGE, registryWith([PAGE, TEASER, QUOTE, DIVIDER]));

  it('builds a block per entry, with a fresh id and the type it names', () => {
    const { blocks } = blocksFromAnswer(components!, [
      { block: 'teaser', fields: { headline: 'Books', text: '<p>Many books.</p>' } },
      { block: 'quote', fields: { quote: 'A room without books...' } },
    ]);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.type).toBe(TEASER.id);
    expect(blocks[0]?.fields).toEqual({ headline: 'Books', text: '<p>Many books.</p>' });
    expect(blocks[1]?.type).toBe(QUOTE.id);
    // Fresh id per block; no layout unless given.
    expect(blocks[0]?.blockId).not.toBe(blocks[1]?.blockId);
    expect(blocks[0]?.layout).toBeUndefined();
  });

  it('drops what it was not offered: unknown blocks, unknown fields, values that are not text', () => {
    const { blocks } = blocksFromAnswer(components!, [
      { block: 'gallery', fields: { headline: 'Nope' } },
      { block: 'teaser', fields: { headline: 'Books', colour: 'red', image: { id: 'x' } } },
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.fields).toEqual({ headline: 'Books' });
  });

  it('honours the maximum the field sets, whatever the model wrote', () => {
    const many = Array.from({ length: 10 }, () => ({ block: 'quote', fields: { quote: 'x' } }));
    expect(blocksFromAnswer(components!, many).blocks).toHaveLength(6);
  });

  it('takes one block for a single-block field, and needs no type named', () => {
    expect(
      blocksFromAnswer(hero!, [{ fields: { headline: 'One' } }, { fields: { headline: 'Two' } }])
        .blocks,
    ).toHaveLength(1);
    expect(blocksFromAnswer(hero!, { fields: { headline: 'One' } }).blocks[0]?.type).toBe(
      TEASER.id,
    );
  });

  it('reads nothing out of an answer that has none', () => {
    expect(blocksFromAnswer(components!, undefined).blocks).toEqual([]);
    expect(blocksFromAnswer(components!, 'a sentence').blocks).toEqual([]);
    expect(blocksFromAnswer(components!, [null, 3]).blocks).toEqual([]);
  });
});

describe('the grid a model chooses', () => {
  const [components, hero] = blockFieldSpecs(PAGE, registryWith([PAGE, TEASER, QUOTE, DIVIDER]));

  const laidOut = (grid: unknown, layouts: unknown[]) =>
    blocksFromAnswer(components!, {
      grid,
      blocks: layouts.map((layout) => ({ block: 'quote', fields: { quote: 'x' }, layout })),
    });

  it('keeps the columns it chose, narrows the tablet and stacks the phone', () => {
    const { grid } = laidOut({ columns: 4 }, []);
    expect(grid).toEqual({
      desktop: { columns: 4 },
      tablet: { columns: 2 },
      mobile: { columns: 1 },
    });
  });

  it('places each block where it was put', () => {
    const { blocks } = laidOut({ columns: 3 }, [
      { column: 1, row: 1, columnSpan: 3, rowSpan: 1 },
      { column: 1, row: 2, columnSpan: 2, rowSpan: 1 },
      { column: 3, row: 2 },
    ]);
    expect(blocks[0]?.layout).toEqual({ column: 1, row: 1, columnSpan: 3, rowSpan: 1 });
    expect(blocks[2]?.layout).toEqual({ column: 3, row: 2, columnSpan: 1, rowSpan: 1 });
  });

  it('drops a placement that reaches past the last column, keeping the block', () => {
    const { blocks } = laidOut({ columns: 2 }, [{ column: 2, row: 1, columnSpan: 2 }]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.layout).toBeUndefined();
  });

  it('drops the second of two blocks that would sit on top of each other', () => {
    const { blocks } = laidOut({ columns: 3 }, [
      { column: 1, row: 1, columnSpan: 2 },
      { column: 2, row: 1, columnSpan: 2 },
      { column: 3, row: 1 },
    ]);
    expect(blocks[0]?.layout).toEqual({ column: 1, row: 1, columnSpan: 2, rowSpan: 1 });
    expect(blocks[1]?.layout).toBeUndefined();
    expect(blocks[2]?.layout).toEqual({ column: 3, row: 1, columnSpan: 1, rowSpan: 1 });
  });

  it('bounds a nonsense column count and ignores a nonsense placement', () => {
    expect(laidOut({ columns: 99 }, []).grid?.desktop?.columns).toBe(12);
    expect(laidOut({ columns: 0 }, []).grid).toBeUndefined();
    expect(laidOut({ columns: 2 }, [{ column: -1, row: 'x' }]).blocks[0]?.layout).toEqual({
      column: 1,
      row: 1,
      columnSpan: 1,
      rowSpan: 1,
    });
  });

  it('gives a single-block field no grid at all', () => {
    expect(
      blocksFromAnswer(hero!, { grid: { columns: 4 }, blocks: [{ fields: {} }] }).grid,
    ).toBeUndefined();
  });
});

describe('imageFieldSpecs', () => {
  it('offers the asset fields that can hold an image', () => {
    expect(
      imageFieldSpecs([
        field('image', 'asset'),
        field('cover', 'asset', { accept: ['image/'] }),
        field('clip', 'asset', { accept: ['video/'] }),
        field('title', 'string'),
      ]).map((entry) => entry.name),
    ).toEqual(['image', 'cover']);
  });

  it('knows a field that holds a list rather than one file', () => {
    expect(isMultipleAsset(field('gallery', 'asset', { multiple: true }))).toBe(true);
    expect(isMultipleAsset(field('image', 'asset'))).toBe(false);
    expect(isMultipleAsset(undefined)).toBe(false);
  });
});

describe('the pictures a document itself asks for', () => {
  it('reads a brief per asset field on the document', () => {
    const offered = imageFieldSpecs([field('cover', 'asset'), field('portrait', 'asset')]);
    const written = readImages(
      { cover: { prompt: 'a shopfront', aspect: '16:9' }, portrait: 'the owner at the till' },
      offered,
    );
    expect(written).toEqual([
      { name: 'cover', label: 'Cover', prompt: 'a shopfront', aspectRatio: '16:9' },
      { name: 'portrait', label: 'Portrait', prompt: 'the owner at the till' },
    ]);
  });
});

describe('the pictures a model asks for', () => {
  const [components] = blockFieldSpecs(PAGE, registryWith([PAGE, TEASER, QUOTE, DIVIDER]));

  it('collects a brief per block picture, named for the block it belongs to', () => {
    const { images, blocks } = blocksFromAnswer(components!, [
      {
        block: 'teaser',
        fields: { headline: 'Books' },
        images: { image: { prompt: 'a shopfront at dusk', aspect: '16:9' } },
      },
    ]);

    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      field: 'components',
      blockId: blocks[0]?.blockId,
      blockField: 'image',
      label: 'Teaser: Image',
      prompt: 'a shopfront at dusk',
      aspectRatio: '16:9',
    });
  });

  it('takes a bare sentence, and drops an aspect the picker does not offer', () => {
    const { images } = blocksFromAnswer(components!, [
      { block: 'teaser', fields: {}, images: { image: 'a shopfront' } },
      { block: 'teaser', fields: {}, images: { image: { prompt: 'a cat', aspect: '21:9' } } },
    ]);
    expect(images[0]).toMatchObject({ prompt: 'a shopfront' });
    expect(images[0]?.aspectRatio).toBeUndefined();
    expect(images[1]?.aspectRatio).toBeUndefined();
  });

  it('asks for nothing where the block has no picture, or the brief is empty', () => {
    const { images } = blocksFromAnswer(components!, [
      { block: 'quote', fields: { quote: 'x' }, images: { image: 'ignored' } },
      { block: 'teaser', fields: {}, images: { image: '  ' } },
    ]);
    expect(images).toEqual([]);
  });
});

describe('repeater fields', () => {
  const quotes = field('quotes', 'repeater', {
    max: 2,
    fields: [
      { name: 'quote', type: 'string', required: true, settings: { max: 140 } },
      { name: 'photo', type: 'asset' },
      { name: 'Bad Name', type: 'string' },
    ],
  });
  const TESTIMONIALS = type(fixedId(24), 'testimonials', 'block', [quotes]);
  const LANDING = type(ids.otherType, 'landing', 'content', [
    quotes,
    field('empty', 'repeater', { fields: [{ name: 'photo', type: 'asset' }] }),
    field('components', 'blocks', { types: [TESTIMONIALS.id] }),
  ]);
  const registry = registryWith([LANDING, TESTIMONIALS]);

  it('offers the text sub-fields of a repeater, and skips one with none', () => {
    const specs = repeaterFieldSpecs(LANDING.fields);
    expect(specs.map((spec) => spec.name)).toEqual(['quotes']);
    expect(specs[0]?.max).toBe(2);
    expect(specs[0]?.fields.map((entry) => entry.name)).toEqual(['quote']);
  });

  it('asks for a list of items, on the document and inside a block', () => {
    const plan = planDocument(LANDING, registry, {});
    const prompt = composeDocumentPrompt({
      instruction: 'a landing page',
      typeLabel: 'Landing',
      fields: plan.fields,
      blockFields: plan.blockFields,
      repeaters: plan.repeaters,
    });
    expect(prompt).toContain('- list "quotes": Quotes - as many items as it needs, at most 2');
    expect(prompt).toContain('    - "quote": Quote (plain text, required, under 140 characters)');
    expect(prompt).toContain('        - "quote": Quote');
    expect(prompt).toContain('A list takes an array of items');
  });

  it('reads items with fresh ids, text only, capped at the maximum', () => {
    const [spec] = repeaterFieldSpecs(LANDING.fields);
    const items = itemsFromAnswer(spec!, [
      { quote: 'Great', photo: 'x', stray: 'y' },
      { fields: { quote: 'Fast' } },
      'nonsense',
      { quote: 'Over the limit' },
    ]);
    expect(items.map((item) => item.fields)).toEqual([{ quote: 'Great' }, { quote: 'Fast' }]);
    expect(items[0]?.itemId).toMatch(/^[0-9a-f-]{36}$/);
    expect(items[0]?.itemId).not.toBe(items[1]?.itemId);
    expect(itemsFromAnswer(spec!, 'not a list')).toEqual([]);
    expect(itemsFromAnswer(spec!, [{ stray: 'y' }])).toEqual([]);
  });

  it('fills repeaters on the document and in blocks', () => {
    const plan = planDocument(LANDING, registry, {});
    const answer = readDocumentAnswer(
      {
        title: 'Hello',
        quotes: [{ quote: 'Great' }],
        empty: [{ photo: 'x' }],
        components: {
          blocks: [{ block: 'testimonials', fields: { quotes: [{ quote: 'Nice' }] } }],
        },
      },
      plan,
    );
    expect(answer.items.quotes?.map((item) => item.fields)).toEqual([{ quote: 'Great' }]);
    expect(answer.items).not.toHaveProperty('empty');
    expect(answer.blocks.components?.[0]?.fields).toMatchObject({
      quotes: [{ itemId: expect.any(String), fields: { quote: 'Nice' } }],
    });
  });
});
