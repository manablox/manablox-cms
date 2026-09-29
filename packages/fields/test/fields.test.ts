import {
  type FieldDefinition,
  FieldTypeRegistry,
  type FieldValueContext,
  fieldDefaultValue,
  fieldIsEmpty,
  fieldSupportsUnique,
  type PluginBlockInstance,
  resolveGraphQL,
  resolveStorage,
  validateFieldSettings,
  validateFieldValue,
} from '@manablox/core';
import { ids } from '@manablox/core/testing';
import { describe, expect, it } from 'vitest';
import {
  blockField,
  blocksField,
  builtinFieldTypes,
  contentField,
  databagField,
  imageSizePreset,
  isBlockGrid,
  isFilterRelation,
  linkField as linkFieldType,
  plainText,
  readImageSizes,
  repeaterField,
  repeaterSubFields,
  resolveBlockGrid,
  stringField,
} from '../src/index.js';

const registry = new FieldTypeRegistry();
for (const type of builtinFieldTypes) registry.register(type);

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

const context = {} as FieldValueContext;

describe('registry', () => {
  it('registers every built-in type under a unique name', () => {
    expect(registry.names).toEqual([
      'asset',
      'block',
      'blocks',
      'boolean',
      'content',
      'databag',
      'date',
      'link',
      'number',
      'repeater',
      'richtext',
      'select',
      'string',
      'template',
      'user',
    ]);
  });

  it('keeps the single-block and multi-block types distinct', () => {
    expect(registry.get('block').name).toBe('block');
    expect(registry.get('blocks').name).toBe('blocks');
    expect(registry.get('blocks')).toBe(blocksField);

    const single = resolveGraphQL(registry.get('block'), { type: crypto.randomUUID() });
    const multiple = resolveGraphQL(registry.get('blocks'), { types: [crypto.randomUUID()] });
    expect(single.list).toBeUndefined();
    expect(multiple.list).toBe(true);
  });

  it('rejects registering two types under one name', () => {
    const other = { ...stringField, label: 'Other' };
    expect(() => registry.register(other)).toThrow(/duplicate/);
  });
});

describe('string', () => {
  it('enforces settings-derived constraints', async () => {
    const f = field({ settings: { min: 3, max: 5, editor: 'input' } });
    const ok = await validateFieldValue(stringField, f, 'abcd', context);
    expect(ok.issues.isEmpty).toBe(true);

    const tooShort = await validateFieldValue(stringField, f, 'ab', context);
    expect(tooShort.issues.isEmpty).toBe(false);
    expect(tooShort.issues.all[0]?.path).toEqual(['title']);
  });

  it('reports a missing value only when the field is required', async () => {
    const optional = await validateFieldValue(stringField, field(), null, context);
    expect(optional.issues.isEmpty).toBe(true);

    const required = await validateFieldValue(
      stringField,
      field({ required: true }),
      null,
      context,
    );
    expect(required.issues.all[0]?.key).toBe('field.required');
  });

  it('skips the index for code blocks, which are never filtered on', () => {
    expect(resolveStorage(stringField, { editor: 'input' }).index).toBe('btree');
    expect(resolveStorage(stringField, { editor: 'code' }).index).toBe(false);
  });

  it('rejects settings that are not valid for the type', async () => {
    const result = await validateFieldSettings(stringField, { editor: 'wysiwyg' });
    expect(result.issues.isEmpty).toBe(false);
  });
});

describe('number', () => {
  it('switches the GraphQL scalar on the integer setting', () => {
    expect(resolveGraphQL(registry.get('number'), { integer: true }).type).toEqual({
      kind: 'scalar',
      name: 'Int',
    });
    expect(resolveGraphQL(registry.get('number'), { integer: false }).type).toEqual({
      kind: 'scalar',
      name: 'Float',
    });
  });

  it('rejects a fractional value when integer is set', async () => {
    const f = field({ type: 'number', settings: { integer: true, format: 'plain' } });
    const result = await validateFieldValue(registry.get('number'), f, 1.5, context);
    expect(result.issues.isEmpty).toBe(false);
  });
});

describe('select', () => {
  it('accepts only declared options', async () => {
    const settings = { options: [{ value: 'a' }, { value: 'b' }], multiple: false };
    const f = field({ type: 'select', settings });
    expect((await validateFieldValue(registry.get('select'), f, 'a', context)).issues.isEmpty).toBe(
      true,
    );
    expect((await validateFieldValue(registry.get('select'), f, 'z', context)).issues.isEmpty).toBe(
      false,
    );
  });

  it('becomes a list when multiple is set', () => {
    expect(
      resolveGraphQL(registry.get('select'), { options: [{ value: 'a' }], multiple: true }).list,
    ).toBe(true);
  });
});

describe('relations', () => {
  it('reports the ids it references so they can be batch-loaded', () => {
    const asset = registry.get('asset');
    const id = crypto.randomUUID();
    expect(asset.references?.(id, { multiple: false, accept: [] })).toEqual([
      { target: 'asset', id },
    ]);
  });

  it('rejects a non-uuid reference', async () => {
    const f = field({ type: 'content', settings: { multiple: false, types: [] } });
    const result = await validateFieldValue(registry.get('content'), f, 'not-a-uuid', context);
    expect(result.issues.isEmpty).toBe(false);
  });
});

describe('richtext', () => {
  it('flattens a ProseMirror document for the search index', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'world' }] },
      ],
    };
    expect(plainText(doc)).toBe('Hello world');
    expect(registry.get('richtext').search?.(doc, {})).toBe('Hello world');
  });
});

describe('blocks', () => {
  it('exposes nested blocks for recursive traversal', () => {
    const block = { blockId: crypto.randomUUID(), type: crypto.randomUUID(), fields: {} };
    expect(blocksField.blocks?.({ blocks: [block] }, { types: [] })).toHaveLength(1);
    expect(blocksField.nested).toBe(true);
  });

  it('enforces min and max counts', async () => {
    const typeId = crypto.randomUUID();
    const f = field({ type: 'blocks', settings: { types: [typeId], max: 1 } });
    const two = [
      { blockId: crypto.randomUUID(), type: typeId, fields: {} },
      { blockId: crypto.randomUUID(), type: typeId, fields: {} },
    ];
    expect((await validateFieldValue(blocksField, f, two, context)).issues.isEmpty).toBe(false);
  });
});

describe('repeater', () => {
  const item = (fields: Record<string, unknown> = {}) => ({ itemId: crypto.randomUUID(), fields });

  it('completes sub-field definitions and never localizes them', () => {
    const [sub] = repeaterSubFields({
      fields: [{ name: 'quote', type: 'string', localized: true } as never],
    });
    expect(sub).toMatchObject({
      id: 'quote',
      name: 'quote',
      label: 'quote',
      settings: {},
      required: false,
      localized: false,
      unique: false,
      admin: { zone: 'main', width: 100, position: 0 },
    });
  });

  it('exposes items for recursive traversal', () => {
    const items = [item({ quote: 'a' }), item({ quote: 'b' })];
    expect(repeaterField.items?.(items, { fields: [] })).toHaveLength(2);
    expect(repeaterField.nested).toBeUndefined();
    expect(resolveGraphQL(repeaterField, {})).toEqual({ type: { kind: 'items' }, list: true });
  });

  it('enforces min and max counts and the item shape', async () => {
    const f = field({ type: 'repeater', settings: { fields: [], min: 1, max: 2 } });
    const run = (value: unknown) => validateFieldValue(repeaterField, f, value, context);
    expect((await run([item()])).issues.isEmpty).toBe(true);
    expect((await run([item(), item(), item()])).issues.isEmpty).toBe(false);
    expect((await run([{ fields: {} }])).issues.isEmpty).toBe(false);
  });

  it('reads an empty list as unfilled', async () => {
    const f = field({ type: 'repeater', required: true, settings: { fields: [] } });
    const result = await validateFieldValue(repeaterField, f, [], context);
    expect(result.issues.all.map((issue) => issue.key)).toEqual(['field.required']);
  });
});

describe('defaults', () => {
  it('produces a sensible initial value for every built-in type', () => {
    const settingsByType: Record<string, Record<string, unknown>> = {
      string: { editor: 'input' },
      richtext: { toolbar: [] },
      number: { integer: false, format: 'plain' },
      boolean: { default: false, display: 'switch' },
      date: { mode: 'datetime', defaultNow: false },
      select: { options: [{ value: 'a' }], multiple: false },
      asset: { multiple: false, accept: [] },
      content: { multiple: false, types: [] },
      user: { multiple: false, roles: [], defaultCurrentUser: false },
      block: { type: crypto.randomUUID() },
      blocks: { types: [crypto.randomUUID()] },
    };

    for (const type of builtinFieldTypes) {
      const value = fieldDefaultValue(type, settingsByType[type.name] ?? {});
      expect(value, `${type.name} default`).not.toBeUndefined();
    }
  });
});

describe('admin component keys', () => {
  it('declares an input component for every type', () => {
    for (const type of builtinFieldTypes) {
      expect(type.admin.input, type.name).toBeTruthy();
    }
  });
});

describe('databag', () => {
  it('takes a type id, limited to the allowed ones when set', async () => {
    const allowed = crypto.randomUUID();
    const open = field({ type: 'databag', settings: {} });
    const limited = field({ type: 'databag', settings: { types: [allowed] } });
    const check = async (f: FieldDefinition, value: unknown) =>
      (await validateFieldValue(databagField, f, value, context)).issues.isEmpty;
    expect(await check(open, crypto.randomUUID())).toBe(true);
    expect(await check(open, null)).toBe(true);
    expect(await check(open, 'not-a-uuid')).toBe(false);
    expect(await check(limited, allowed)).toBe(true);
    expect(await check(limited, crypto.randomUUID())).toBe(false);
  });
});

describe('blocks layout', () => {
  const typeId = crypto.randomUUID();
  const block = (layout?: Record<string, number>) => ({
    blockId: crypto.randomUUID(),
    type: typeId,
    fields: {},
    ...(layout ? { layout } : {}),
  });

  it('keeps a layout that fits the grid', async () => {
    const f = field({ type: 'blocks', settings: { types: [typeId] } });
    const result = await validateFieldValue(
      blocksField,
      f,
      { grid: { desktop: { columns: 3 } }, blocks: [block({ column: 2, columnSpan: 2, row: 1 })] },
      context,
    );
    expect(result.issues.isEmpty).toBe(true);
    expect((result.value as { blocks: { layout?: unknown }[] }).blocks[0]?.layout).toEqual({
      column: 2,
      columnSpan: 2,
      row: 1,
    });
  });

  it('rejects a block that reaches past the last column or row', async () => {
    const f = field({ type: 'blocks', settings: { types: [typeId] } });
    const grid = { desktop: { columns: 3, rows: 2 } };
    const wide = await validateFieldValue(
      blocksField,
      f,
      { grid, blocks: [block({ column: 3, columnSpan: 2 })] },
      context,
    );
    expect(wide.issues.isEmpty).toBe(false);
    expect(wide.issues.all[0]?.path).toEqual(['title', 0, 'layout']);

    const tall = await validateFieldValue(
      blocksField,
      f,
      { grid, blocks: [block({ row: 2, rowSpan: 2 })] },
      context,
    );
    expect(tall.issues.isEmpty).toBe(false);
  });

  it('rejects a layout on a plain list, and a bare array', async () => {
    const f = field({ type: 'blocks', settings: { types: [typeId] } });
    const result = await validateFieldValue(
      blocksField,
      f,
      { blocks: [block({ column: 1 })] },
      context,
    );
    expect(result.issues.isEmpty).toBe(false);

    const plain = await validateFieldValue(blocksField, f, { blocks: [block()] }, context);
    expect(plain.issues.isEmpty).toBe(true);
    expect((plain.value as { blocks: unknown[] }).blocks).toHaveLength(1);

    const bare = await validateFieldValue(blocksField, f, [block()], context);
    expect(bare.issues.isEmpty).toBe(false);
  });

  it('bounds the grid it accepts, and the block count by min and max', async () => {
    const f = field({ type: 'blocks', settings: { types: [typeId], max: 1 } });
    const wide = await validateFieldValue(
      blocksField,
      f,
      { grid: { desktop: { columns: 13 } }, blocks: [] },
      context,
    );
    expect(wide.issues.isEmpty).toBe(false);

    const many = await validateFieldValue(blocksField, f, { blocks: [block(), block()] }, context);
    expect(many.issues.isEmpty).toBe(false);
  });
});

describe('block extensions', () => {
  const typeId = crypto.randomUUID();
  const block = (ext?: Record<string, unknown>) => ({
    blockId: crypto.randomUUID(),
    type: typeId,
    fields: {},
    ...(ext ? { ext } : {}),
  });
  const seen: unknown[] = [];
  const acme: PluginBlockInstance = {
    validate: (value, where) => {
      seen.push(where);
      return typeof value === 'object' && value !== null && 'tone' in value
        ? []
        : [{ path: ['tone'], message: 'is required' }];
    },
    strip: (value) => (Object.keys(value as object).length > 1 ? value : undefined),
  };
  const on = {
    ...context,
    spaceId: 's1',
    locale: 'en',
    blockExtensions: new Map([['acme', acme]]),
  };
  const f = field({ type: 'blocks', settings: { types: [typeId] } });
  const validate = (ext: Record<string, unknown>, where: FieldValueContext = on) =>
    validateFieldValue(blocksField, f, { blocks: [block(ext)] }, where);
  const stored = (result: { value: unknown }) =>
    (result.value as { blocks: { ext?: unknown }[] }).blocks[0]?.ext;

  it("stores a plugin's data as its check strips it", async () => {
    const result = await validate({ acme: { tone: 'dark', size: 2 } });
    expect(result.issues.isEmpty).toBe(true);
    expect(stored(result)).toEqual({ acme: { tone: 'dark', size: 2 } });
    expect(seen.at(-1)).toEqual({ type: typeId, spaceId: 's1', locale: 'en' });
    // Stripped to nothing, the key and the empty `ext` go.
    expect(stored(await validate({ acme: { tone: 'dark' } }))).toBeUndefined();
  });

  it('points issues at the plugin data', async () => {
    const result = await validate({ acme: { size: 2 } });
    expect(result.issues.all[0]?.path).toEqual(['title', 'blocks', 0, 'ext', 'acme', 'tone']);
  });

  it('drops incoming data of plugins that are unknown or off; the service keeps what is stored', async () => {
    const result = await validate({ other: { a: 1 }, acme: { tone: 'x', b: 1 } });
    expect(stored(result)).toEqual({ acme: { tone: 'x', b: 1 } });
    expect(stored(await validate({ acme: { tone: 'x', b: 1 } }, context))).toBeUndefined();
  });

  it('checks a single block field too', async () => {
    const single = field({ type: 'block', settings: { type: typeId } });
    const result = await validateFieldValue(blockField, single, block({ acme: {} }), on);
    expect(result.issues.isEmpty).toBe(false);
  });
});

describe('blocks breakpoints', () => {
  const typeId = crypto.randomUUID();
  const block = (layout?: Record<string, unknown>) => ({
    blockId: crypto.randomUUID(),
    type: typeId,
    fields: {},
    ...(layout ? { layout } : {}),
  });

  it('bounds each breakpoint by its own grid', async () => {
    const f = field({ type: 'blocks', settings: { types: [typeId] } });
    const grid = { desktop: { columns: 4 }, tablet: { columns: 2 }, mobile: { columns: 1 } };
    const ok = await validateFieldValue(
      blocksField,
      f,
      { grid, blocks: [block({ column: 3, columnSpan: 2, tablet: { column: 1, columnSpan: 2 } })] },
      context,
    );
    expect(ok.issues.isEmpty).toBe(true);

    const tabletTooWide = await validateFieldValue(
      blocksField,
      f,
      { grid, blocks: [block({ column: 1, tablet: { column: 2, columnSpan: 2 } })] },
      context,
    );
    expect(tabletTooWide.issues.isEmpty).toBe(false);
  });

  it('resolves the grid per breakpoint', () => {
    expect(resolveBlockGrid({ desktop: { columns: 3, rows: 2 } })).toEqual({
      desktop: { columns: 3, rows: 2 },
      tablet: { columns: 3, rows: 2 },
      mobile: { columns: 1 },
    });
    expect(
      resolveBlockGrid({ desktop: { columns: 3 }, tablet: { columns: 2 }, mobile: { columns: 2 } }),
    ).toEqual({
      desktop: { columns: 3 },
      tablet: { columns: 2 },
      mobile: { columns: 2 },
    });
    expect(isBlockGrid(resolveBlockGrid(undefined))).toBe(false);
    expect(isBlockGrid(resolveBlockGrid({ mobile: { columns: 2 } }))).toBe(true);
  });
});

describe('link', () => {
  const linkField = (settings: Record<string, unknown> = {}) =>
    field({ name: 'cta', type: 'link', settings });

  const validate = async (settings: Record<string, unknown>, value: unknown) => {
    const parsed = await validateFieldSettings(linkFieldType, settings);
    expect(parsed.issues.isEmpty).toBe(true);
    return validateFieldValue(
      linkFieldType,
      linkField(parsed.settings as Record<string, unknown>),
      value,
      context,
    );
  };

  it('wants a document for an internal link and an address for an external one', async () => {
    const noDocument = await validate({}, { mode: 'internal', contentId: null });
    expect(noDocument.issues.isEmpty).toBe(false);

    const noAddress = await validate({}, { mode: 'external', url: '' });
    expect(noAddress.issues.isEmpty).toBe(false);

    const ok = await validate({}, { mode: 'internal', contentId: ids.doc });
    expect(ok.issues.isEmpty).toBe(true);
  });

  it('gives a scheme-less address the benefit of https, and refuses one that executes', async () => {
    const bare = await validate({}, { mode: 'external', url: 'example.com/page' });
    expect(bare.issues.isEmpty).toBe(true);
    expect(bare.value).toMatchObject({ url: 'https://example.com/page' });

    for (const url of ['javascript:alert(1)', 'data:text/html,<script>']) {
      const refused = await validate({}, { mode: 'external', url });
      expect(refused.issues.isEmpty).toBe(false);
    }

    for (const url of ['/about', '#top', 'mailto:a@b.c', 'tel:+49123']) {
      const allowed = await validate({}, { mode: 'external', url });
      expect(allowed.issues.isEmpty).toBe(true);
    }
  });

  /** Stored settings are undefaulted, so untouched defaults arrive as `{}`. */
  it('treats an unset setting as its default rather than as off', async () => {
    const result = await validateFieldValue(
      linkFieldType,
      linkField({}),
      { mode: 'internal', contentId: ids.doc },
      context,
    );
    expect(result.issues.isEmpty).toBe(true);
    expect(result.value).toMatchObject({ target: '_self' });
  });

  it('refuses the end the field does not offer', async () => {
    const refused = await validate(
      { allowExternal: false },
      { mode: 'external', url: 'https://example.com' },
    );
    expect(refused.issues.isEmpty).toBe(false);
  });

  it('holds the tab to the default when the editor is not offered the choice', async () => {
    const forced = await validate(
      { allowTarget: false, defaultTarget: '_blank' },
      { mode: 'external', url: 'https://example.com', target: '_self' },
    );
    expect(forced.value).toMatchObject({ target: '_blank' });
  });

  it('holds an internal link as a content reference, and an external one as nothing', async () => {
    const settings = (await validateFieldSettings(linkFieldType, {})).settings as never;
    const value = (over: Record<string, unknown>) => ({
      mode: 'internal' as const,
      contentId: null,
      url: null,
      target: '_self' as const,
      label: null,
      ...over,
    });
    expect(linkFieldType.references?.(value({ contentId: ids.doc }), settings)).toEqual([
      { target: 'content', id: ids.doc },
    ]);
    expect(
      linkFieldType.references?.(value({ mode: 'external', url: 'https://x.dev' }), settings),
    ).toEqual([]);
  });
});

describe('relations', () => {
  it('is a standing query only when several values are allowed', () => {
    expect(isFilterRelation({ multiple: true, selection: 'filter' })).toBe(true);
    expect(isFilterRelation({ multiple: false, selection: 'filter' })).toBe(false);
    expect(isFilterRelation({ multiple: true, selection: 'pick' })).toBe(false);
    expect(isFilterRelation({})).toBe(false);
  });

  it('holds no references while it is a standing query: what it delivers is not stored', async () => {
    const settings = async (over: Record<string, unknown>) =>
      (await validateFieldSettings(contentField, { multiple: true, ...over })).settings as never;

    expect(contentField.references?.([ids.doc], await settings({ selection: 'pick' }))).toEqual([
      { target: 'content', id: ids.doc },
    ]);
    expect(contentField.references?.([ids.doc], await settings({ selection: 'filter' }))).toEqual(
      [],
    );
  });
});

describe('image sizes', () => {
  it('names a size by its measurements, so two fields wanting it share the one file', () => {
    const hero = { name: 'hero', width: 1600, height: 900, fit: 'cover', format: 'webp' } as const;
    const banner = { ...hero, name: 'banner' };
    expect(imageSizePreset(hero)).toBe(imageSizePreset(banner));
    expect(imageSizePreset(hero)).toBe('s-1600x900-cover-webp-82');
    expect(imageSizePreset({ ...hero, height: 450 })).not.toBe(imageSizePreset(hero));
  });

  it('skips an entry it cannot read rather than refusing the whole field', () => {
    const sizes = readImageSizes({
      sizes: [{ name: 'hero', width: 1600 }, { name: 'NOT A NAME', width: 100 }, 'nonsense'],
    });
    expect(sizes.map((size) => size.name)).toEqual(['hero']);
    expect(sizes[0]).toMatchObject({ fit: 'cover', format: 'webp' });
  });
});

describe('required and empty values', () => {
  const requiredKey = async (type: string, settings: Record<string, unknown>, value: unknown) => {
    const f = field({ type, settings, required: true });
    const result = await validateFieldValue(registry.get(type), f, value, context);
    return result.issues.all.map((issue) => issue.key);
  };
  const doc = (...content: unknown[]) => ({ type: 'doc', content });
  const select = { options: [{ value: 'a' }], multiple: true };

  it('rejects empty and whitespace-only text', async () => {
    expect(await requiredKey('string', {}, '')).toEqual(['field.required']);
    expect(await requiredKey('string', {}, '  \n')).toEqual(['field.required']);
    // Missing, not too short.
    expect(await requiredKey('string', { min: 3 }, '')).toEqual(['field.required']);
    expect(await requiredKey('string', {}, 'x')).toEqual([]);
  });

  it('rejects rich text without text, but keeps a divider', async () => {
    expect(await requiredKey('richtext', {}, doc())).toEqual(['field.required']);
    expect(await requiredKey('richtext', {}, doc({ type: 'paragraph' }))).toEqual([
      'field.required',
    ]);
    expect(await requiredKey('richtext', {}, '<p> </p>')).toEqual(['field.required']);
    expect(await requiredKey('richtext', {}, doc({ type: 'horizontalRule' }))).toEqual([]);
    expect(
      await requiredKey(
        'richtext',
        {},
        doc({ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }),
      ),
    ).toEqual([]);
  });

  it('rejects empty lists', async () => {
    expect(await requiredKey('select', select, [])).toEqual(['field.required']);
    expect(await requiredKey('select', select, ['a'])).toEqual([]);
    expect(await requiredKey('asset', { multiple: true }, [])).toEqual(['field.required']);
    expect(await requiredKey('blocks', {}, { blocks: [] })).toEqual(['field.required']);
  });

  it('never calls a standing query empty, since it stores nothing', async () => {
    expect(await requiredKey('content', { multiple: true, selection: 'filter' }, [])).toEqual([]);
  });

  it('keeps zero and false as values', async () => {
    expect(await requiredKey('number', {}, 0)).toEqual([]);
    expect(await requiredKey('boolean', {}, false)).toEqual([]);
  });

  it('offers unique only for single scalar values', () => {
    const unique = (type: string, settings: Record<string, unknown> = {}) =>
      fieldSupportsUnique(registry.get(type), settings);
    expect(unique('string')).toBe(true);
    expect(unique('number')).toBe(true);
    expect(unique('date')).toBe(true);
    expect(unique('select', { multiple: false })).toBe(true);
    expect(unique('select', { multiple: true })).toBe(false);
    expect(unique('content', { multiple: false })).toBe(true);
    expect(unique('asset', { multiple: true })).toBe(false);
    expect(unique('richtext')).toBe(false);
    expect(unique('boolean')).toBe(false);
    expect(unique('blocks')).toBe(false);
  });

  it('treats empty values alike for unique and required', () => {
    expect(fieldIsEmpty(stringField, ' ', {})).toBe(true);
    expect(fieldIsEmpty(stringField, null, {})).toBe(true);
    expect(fieldIsEmpty(registry.get('number'), 0, {})).toBe(false);
  });
});
