import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceContext, type ServiceContext } from '../src/testing.js';

let ctx: ServiceContext;
let spaceId: string;

beforeAll(async () => {
  ctx = await createServiceContext('content_type_hooks', {
    fieldTypes: builtinFieldTypes,
    contentTypes: [],
  });
  const space = await ctx.spaces.create(
    { name: 'Types', machineName: 'types', url: 'https://types.example.com' },
    null,
  );
  spaceId = space.id;
});
afterAll(async () => {
  await ctx?.close();
});

describe('content type hooks and cache', () => {
  it('runs the write hooks, uses their input and purges the type and space', async () => {
    const seen: string[] = [];
    const purged: string[][] = [];
    const offs = [
      ctx.manablox.hooks.on('contentType:beforeCreate', (input) => {
        seen.push('beforeCreate');
        return { ...input, label: 'Hooked' };
      }),
      ctx.manablox.hooks.on('contentType:beforeUpdate', (input, context) => {
        seen.push(`beforeUpdate:${context.previous.label}`);
        return { ...input, description: 'From the hook' };
      }),
      ctx.manablox.hooks.on('contentType:afterDelete', (type) => {
        seen.push(`afterDelete:${type.name}`);
      }),
      ctx.manablox.hooks.on('cache:purge', ({ tags }) => {
        purged.push(tags);
      }),
    ];
    try {
      const created = await ctx.contentTypes.create({
        name: 'article',
        spaceId,
        fields: [{ name: 'body', type: 'string' }],
      });
      expect(created.label).toBe('Hooked');

      const updated = await ctx.contentTypes.update(spaceId, created.id, {
        name: 'article',
        label: 'Article',
        spaceId,
        fields: [{ name: 'body', type: 'string' }],
      });
      expect(updated.description).toBe('From the hook');

      await ctx.contentTypes.delete(spaceId, created.id);

      expect(seen).toEqual(['beforeCreate', 'beforeUpdate:Hooked', 'afterDelete:article']);
      const expected = [`type:${created.id}`, `space:${spaceId}`];
      expect(purged).toEqual([expected, expected, expected]);
    } finally {
      for (const off of offs) off();
    }
  });

  it('validates what beforeCreate returns', async () => {
    const off = ctx.manablox.hooks.on('contentType:beforeCreate', (input) => ({
      ...input,
      name: 'Not A Machine Name',
    }));
    try {
      await expect(
        ctx.contentTypes.create({ name: 'fine', spaceId, fields: [] }),
      ).rejects.toMatchObject({ key: 'contentType.validation.failed' });
    } finally {
      off();
    }
  });
});

describe('content type space scope', () => {
  it('reads, updates and deletes a type only through its own space', async () => {
    const type = await ctx.contentTypes.create({
      name: 'scoped',
      spaceId,
      fields: [{ name: 'body', type: 'string' }],
    });
    const other = ctx.spaceId;
    const notFound = expect.objectContaining({ key: 'contentType.notFound' });

    expect(ctx.contentTypes.get(spaceId, type.id).id).toBe(type.id);
    expect(() => ctx.contentTypes.get(other, type.id)).toThrow(notFound);
    await expect(
      ctx.contentTypes.update(other, type.id, { name: 'scoped', spaceId: other, fields: [] }),
    ).rejects.toThrow(notFound);
    await expect(ctx.contentTypes.delete(other, type.id)).rejects.toThrow(notFound);

    await ctx.contentTypes.delete(spaceId, type.id);
  });
});

describe('repeater sub-fields', () => {
  const repeater = (fields: unknown[]) => ({
    name: 'items',
    type: 'repeater',
    settings: { fields },
  });

  const detailsOf = (fields: unknown[]) =>
    ctx.contentTypes
      .create({ name: 'with_items', spaceId, fields: [repeater(fields)] } as never)
      .then(
        () => [],
        (error) => error.details.map((d: { key: string; path: unknown[] }) => [d.key, d.path]),
      );

  it('checks sub-fields like top-level fields, under settings.fields', async () => {
    expect(
      await detailsOf([
        { name: 'Bad Name', type: 'string' },
        { name: 'twice', type: 'string' },
        { name: 'twice', type: 'number' },
        { name: 'ghost', type: 'nope' },
        { name: 'short', type: 'string', settings: { max: -1 } },
        { name: 'tile', type: 'block', settings: { type: crypto.randomUUID() } },
      ]),
    ).toEqual([
      ['contentType.field.name.invalid', ['fields', 0, 'settings', 'fields', 0, 'name']],
      ['contentType.field.name.duplicate', ['fields', 0, 'settings', 'fields', 2, 'name']],
      ['contentType.field.type.notFound', ['fields', 0, 'settings', 'fields', 3, 'type']],
      [expect.any(String), ['fields', 0, 'settings', 'fields', 4, 'settings', 'max']],
      ['contentType.field.blockType.notFound', ['fields', 0, 'settings', 'fields', 5, 'settings']],
    ]);
  });

  it('allows repeaters in repeaters up to a depth', async () => {
    const nest = (depth: number): unknown =>
      depth === 0 ? { name: 'leaf', type: 'string' } : repeater([nest(depth - 1)]);
    expect(await detailsOf([nest(1)])).toEqual([]);
    await ctx.contentTypes.delete(
      spaceId,
      ctx.manablox.contentTypes.tryGetByName('with_items', spaceId)?.id as string,
    );
    expect(await detailsOf([nest(2)])).toEqual([
      [
        'contentType.field.subFields.tooDeep',
        ['fields', 0, 'settings', 'fields', 0, 'settings', 'fields', 0, 'settings'],
      ],
    ]);
  });
});
