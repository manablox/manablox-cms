import {
  defineContentType,
  type FieldDefinition,
  type FieldValueContext,
  validateFieldValue,
} from '@manablox/core';
import { blocksField, builtinFieldTypes } from '@manablox/fields';
import { findUnplacedFields, generateBlockDesign, validateSiteDesign } from '@manablox/site';
import { describe, expect, it } from 'vitest';
import { websiteBlocks } from '../../src/server/blocks.js';
import { websiteTypeData } from '../../src/server/services/site/blocks.js';

const field = (over: Partial<FieldDefinition> = {}): FieldDefinition => ({
  id: 'f1',
  name: 'title',
  label: 'Title',
  type: 'string',
  settings: {},
  required: false,
  localized: false,
  unique: false,
  admin: { zone: 'main', width: 100, position: 0 },
  ...over,
});

describe('block design at ext.website', () => {
  const typeId = crypto.randomUUID();
  const context = {
    spaceId: 's1',
    locale: 'en',
    blockExtensions: new Map([['website', websiteBlocks.instance!]]),
  } as unknown as FieldValueContext;
  const f = field({ type: 'blocks', settings: { types: [typeId] } });
  const validate = (design: unknown) =>
    validateFieldValue(
      blocksField,
      f,
      {
        blocks: [
          { blockId: crypto.randomUUID(), type: typeId, fields: {}, ext: { website: design } },
        ],
      },
      context,
    );

  it('keeps a variant and token style overrides', async () => {
    const design = {
      variant: 'dark-hero',
      style: {
        background: 'color:primary',
        paddingY: 'space:8',
        textAlign: 'center',
        width: 'full',
        hide: ['mobile'],
        backgroundImage: { assetId: crypto.randomUUID(), size: 'cover' },
      },
    };
    const result = await validate(design);
    expect(result.issues.isEmpty).toBe(true);
    expect((result.value as { blocks: { ext?: unknown }[] }).blocks[0]?.ext).toEqual({
      website: design,
    });
  });

  it('accepts an unknown variant name and a design without style', async () => {
    expect((await validate({ variant: 'not-in-the-design' })).issues.isEmpty).toBe(true);
    expect((await validate({})).issues.isEmpty).toBe(true);
  });

  it('rejects bad variants, unknown keys and styles outside the allow-list', async () => {
    for (const design of [
      { variant: 3 },
      { variant: '' },
      { variant: 'x'.repeat(65) },
      { variant: 'has space' },
      { colour: 'red' },
      { style: { background: '#ff0000' } },
      { style: { fontSize: '99px' } },
      { style: { hide: ['watch'] } },
      { style: 'color:primary' },
      'default',
    ]) {
      expect((await validate(design)).issues.isEmpty, JSON.stringify(design)).toBe(false);
    }
  });

  it('points issues at the style property', async () => {
    const result = await validate({ style: { paddingY: 'lots' } });
    expect(result.issues.all[0]?.path).toEqual([
      'title',
      'blocks',
      0,
      'ext',
      'website',
      'style',
      'paddingY',
    ]);
  });

  it('delivers a design with a variant or a style only', () => {
    const { serialize, field: key } = websiteBlocks.publicApi!;
    expect(key).toBe('design');
    expect(serialize({ variant: 'wide' })).toEqual({ variant: 'wide' });
    expect(serialize({ style: { width: 'full' } })).toEqual({ style: { width: 'full' } });
    expect(serialize({})).toBeUndefined();
    expect(serialize({ style: {} })).toBeUndefined();
  });
});

describe('code block designs at plugins.website', () => {
  const design = generateBlockDesign({ fields: [] });

  it('accepts a valid design on a block type only', () => {
    const block = defineContentType({ name: 'hero', kind: 'block', fields: [] });
    expect(websiteTypeData.validate(design, block)).toEqual([]);
    expect(websiteTypeData.validate({ variants: 3 }, block).length).toBeGreaterThan(0);
    const page = defineContentType({ name: 'page', fields: [] });
    expect(websiteTypeData.validate(design, page)).toEqual([
      { message: 'only block types may bring a design' },
    ]);
  });
});

describe('site generator', () => {
  it('places every built-in field type in a generated block design', () => {
    const settings: Record<string, Record<string, unknown>> = {
      select: { options: [{ value: 'a' }] },
      repeater: { fields: [{ id: 'sub', name: 'sub', type: 'string' }] },
    };
    const type = {
      fields: builtinFieldTypes.map((fieldType, index) =>
        field({
          id: `f_${fieldType.name}`,
          name: `f_${fieldType.name}`,
          type: fieldType.name,
          settings: settings[fieldType.name] ?? {},
          admin: { zone: 'main', width: 100, position: index },
        }),
      ),
    };
    const generated = generateBlockDesign(type);
    expect(findUnplacedFields(generated, type)).toEqual([]);
    expect(validateSiteDesign('block', generated)).toMatchObject({ ok: true });
  });
});
