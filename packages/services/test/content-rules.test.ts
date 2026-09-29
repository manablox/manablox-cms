import { type ContentTypeInput, ManabloxError } from '@manablox/core';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceContext, type ServiceContext } from '../src/testing.js';

const TYPES: ContentTypeInput[] = [
  {
    name: 'product',
    fields: [
      { name: 'sku', type: 'string', unique: true },
      { name: 'handle', type: 'string', unique: true, localized: true },
      {
        name: 'tags',
        type: 'select',
        unique: true,
        settings: { options: [{ value: 'a' }], multiple: true },
      },
      { name: 'note', type: 'string' },
    ],
  },
  {
    name: 'form',
    fields: [
      { name: 'heading', type: 'string', required: true },
      { name: 'body', type: 'richtext', required: true },
      {
        name: 'choices',
        type: 'select',
        required: true,
        settings: { options: [{ value: 'a' }], multiple: true },
      },
      { name: 'count', type: 'number', required: true },
    ],
  },
  {
    name: 'variant',
    fields: [
      { name: 'sku', type: 'string', unique: true },
      { name: 'rank', type: 'number', unique: true },
    ],
  },
  { name: 'page', fields: [] },
];

let ctx: ServiceContext;

beforeAll(async () => {
  ctx = await createServiceContext('content_rules', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TYPES,
  });
});
afterAll(async () => {
  await ctx?.close();
});

let counter = 0;
const input = (
  type: string,
  fields: Record<string, unknown>,
  over: Record<string, unknown> = {},
) => {
  counter += 1;
  return {
    spaceId: ctx.spaceId,
    typeId: ctx.ids[type] as string,
    locale: 'en',
    title: `Doc ${counter}`,
    slug: `doc-${counter}`,
    fields,
    ...over,
  };
};

/** The detail keys and paths of a validation failure. */
async function failure(promise: Promise<unknown>): Promise<{ key: string; path?: unknown[] }[]> {
  const error = await promise.then(
    () => null,
    (err: unknown) => err,
  );
  expect(ManabloxError.is(error)).toBe(true);
  const details = (error as ManabloxError).details;
  return details.map(({ key, path }) => ({ key, ...(path ? { path } : {}) }));
}

describe('required', () => {
  const valid = {
    heading: 'Hi',
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] },
    choices: ['a'],
    count: 0,
  };

  it('rejects empty text, rich text and lists on save, not only missing values', async () => {
    const details = await failure(
      ctx.content.create(
        input('form', {
          heading: '   ',
          body: { type: 'doc', content: [] },
          choices: [],
          count: 0,
        }),
      ),
    );
    expect(details).toEqual([
      { key: 'field.required', path: ['heading'] },
      { key: 'field.required', path: ['body'] },
      { key: 'field.required', path: ['choices'] },
    ]);
  });

  it('rejects clearing a required field on update', async () => {
    const row = await ctx.content.create(input('form', valid));
    const details = await failure(
      ctx.content.update(
        ctx.spaceId,
        row.id,
        input('form', { ...valid, heading: '' }, { slug: row.slug }),
      ),
    );
    expect(details).toEqual([{ key: 'field.required', path: ['heading'] }]);
  });

  it('still fills a new form with empty defaults', async () => {
    const fields = await ctx.content.initFields(
      ctx.manablox.contentTypes.get(ctx.ids.form as string),
    );
    expect(fields.heading).toBe('');
    expect(fields.choices).toEqual([]);
  });
});

describe('unique', () => {
  it('refuses a value another document of the type holds, at the field', async () => {
    await ctx.content.create(input('variant', { sku: 'A-1', rank: 1 }));
    const details = await failure(ctx.content.create(input('variant', { sku: 'A-1', rank: 1 })));
    expect(details).toEqual([
      { key: 'field.unique', path: ['sku'] },
      { key: 'field.unique', path: ['rank'] },
    ]);
  });

  it('allows the same value in another type, or in a field without the rule', async () => {
    await ctx.content.create(input('product', { sku: 'CROSS', note: 'same' }));
    await expect(
      ctx.content.create(input('variant', { sku: 'CROSS', rank: 2 })),
    ).resolves.toBeTruthy();
    await expect(ctx.content.create(input('product', { note: 'same' }))).resolves.toBeTruthy();
  });

  it('lets a document keep its own value and ignores empty values', async () => {
    const row = await ctx.content.create(input('product', { sku: 'KEEP' }));
    await expect(
      ctx.content.update(
        ctx.spaceId,
        row.id,
        input('product', { sku: 'KEEP', note: 'x' }, { slug: row.slug }),
      ),
    ).resolves.toBeTruthy();

    await ctx.content.create(input('product', { sku: '' }));
    await expect(ctx.content.create(input('product', { sku: '  ' }))).resolves.toBeTruthy();
  });

  it('refuses taking another document value on update', async () => {
    await ctx.content.create(input('product', { sku: 'TAKEN' }));
    const row = await ctx.content.create(input('product', { sku: 'FREE' }));
    const details = await failure(
      ctx.content.update(
        ctx.spaceId,
        row.id,
        input('product', { sku: 'TAKEN' }, { slug: row.slug }),
      ),
    );
    expect(details).toEqual([{ key: 'field.unique', path: ['sku'] }]);
  });

  it('never compares a document with its own translations', async () => {
    const row = await ctx.content.create(input('product', { sku: 'TR-1', handle: 'tr' }));
    const translation = await ctx.content.createTranslation(ctx.spaceId, row.id, 'de');
    expect(translation.fields.sku).toBe('TR-1');
    expect(translation.fields.handle).toBe('tr');
  });

  it('compares localized fields within a locale, shared fields across locales', async () => {
    await ctx.content.create(input('product', { sku: 'LOC-EN', handle: 'boots' }));
    // Another document may use the same localized value in another locale...
    await expect(
      ctx.content.create(input('product', { handle: 'boots' }, { locale: 'de' })),
    ).resolves.toBeTruthy();
    // ...but not the same shared value.
    const details = await failure(
      ctx.content.create(input('product', { sku: 'LOC-EN' }, { locale: 'de' })),
    );
    expect(details).toEqual([{ key: 'field.unique', path: ['sku'] }]);
  });

  it('does not apply to list values', async () => {
    await ctx.content.create(input('product', { tags: ['a'] }));
    await expect(ctx.content.create(input('product', { tags: ['a'] }))).resolves.toBeTruthy();
  });

  it('checks the live copies on publish', async () => {
    const first = await ctx.content.create(input('product', { sku: 'LIVE' }));
    await ctx.content.publish(ctx.spaceId, first.id);
    // The draft moves on, the live copy still holds the value.
    await ctx.content.update(
      ctx.spaceId,
      first.id,
      input('product', { sku: 'LIVE-2' }, { slug: first.slug }),
    );
    const second = await ctx.content.create(input('product', { sku: 'LIVE' }));

    const details = await failure(ctx.content.publish(ctx.spaceId, second.id));
    expect(details).toEqual([{ key: 'field.unique', path: ['sku'] }]);

    await ctx.content.publish(ctx.spaceId, first.id);
    await expect(ctx.content.publish(ctx.spaceId, second.id)).resolves.toBeTruthy();
  });

  it('leaves unique fields at their defaults on a duplicate', async () => {
    const row = await ctx.content.create(input('product', { sku: 'DUP', note: 'kept' }));
    const copy = await ctx.content.duplicate(ctx.spaceId, row.id);
    expect(copy.fields.sku).toBe('');
    expect(copy.fields.note).toBe('kept');
  });
});

describe('unpublishing a parent', () => {
  it('sets every document whose live copy went back to draft, with hooks, purge and audit', async () => {
    const root = await ctx.content.create(input('page', {}));
    const child = await ctx.content.create(input('page', {}, { parentId: root.id }));
    const grandchild = await ctx.content.create(input('page', {}, { parentId: child.id }));
    const draftChild = await ctx.content.create(input('page', {}, { parentId: root.id }));
    for (const row of [root, child, grandchild]) await ctx.content.publish(ctx.spaceId, row.id);

    const unpublished: string[] = [];
    const purged: string[][] = [];
    const offUnpublish = ctx.manablox.hooks.on('content:afterUnpublish', ({ id }) => {
      unpublished.push(id);
    });
    const offPurge = ctx.manablox.hooks.on('cache:purge', ({ tags }) => {
      purged.push(tags);
    });

    await ctx.content.unpublish(ctx.spaceId, root.id);
    offUnpublish();
    offPurge();

    expect(unpublished[0]).toBe(root.id);
    expect(new Set(unpublished)).toEqual(new Set([root.id, child.id, grandchild.id]));
    expect(purged).toHaveLength(1);
    expect(purged[0]).toEqual(
      expect.arrayContaining([
        `content:${root.id}`,
        `content:${child.id}`,
        `content:${grandchild.id}`,
      ]),
    );
    expect(purged[0]).not.toContain(`content:${draftChild.id}`);

    for (const row of [root, child, grandchild]) {
      const draft = await ctx.content.get(ctx.spaceId, row.id);
      expect(draft?.status).toBe('draft');
      expect(draft?.publishedAt).toBeNull();
      expect(await ctx.content.get(ctx.spaceId, row.id, { published: true })).toBeNull();
    }

    const { items: entries } = await ctx.repos.audit.pageByTarget({
      kind: 'content',
      id: grandchild.id,
    });
    const entry = entries.find((each) => each.action === 'content.unpublish');
    expect(entry?.meta).toMatchObject({ ancestorId: root.id });
  });
});

describe('deleting a parent', () => {
  it('reports every deleted descendant with hooks, one purge and audit', async () => {
    const root = await ctx.content.create(input('page', {}));
    const child = await ctx.content.create(input('page', {}, { parentId: root.id }));
    const grandchild = await ctx.content.create(input('page', {}, { parentId: child.id }));
    const bystander = await ctx.content.create(input('page', {}));

    const deleted: { id: string; record: string }[] = [];
    const purged: string[][] = [];
    const offDelete = ctx.manablox.hooks.on('content:afterDelete', ({ id, record }) => {
      deleted.push({ id, record: record.id });
    });
    const offPurge = ctx.manablox.hooks.on('cache:purge', ({ tags }) => {
      purged.push(tags);
    });

    expect(await ctx.content.delete(ctx.spaceId, root.id)).toBe(3);
    offDelete();
    offPurge();

    expect(deleted[0]).toEqual({ id: root.id, record: root.id });
    expect(new Set(deleted.map((each) => each.id))).toEqual(
      new Set([root.id, child.id, grandchild.id]),
    );
    expect(deleted.every((each) => each.id === each.record)).toBe(true);
    expect(purged).toHaveLength(1);
    expect(purged[0]).toEqual(
      expect.arrayContaining([
        `content:${root.id}`,
        `content:${child.id}`,
        `content:${grandchild.id}`,
      ]),
    );
    expect(purged[0]).not.toContain(`content:${bystander.id}`);

    const { items: entries } = await ctx.repos.audit.pageByTarget({
      kind: 'content',
      id: grandchild.id,
    });
    const entry = entries.find((each) => each.action === 'content.delete');
    expect(entry?.meta).toMatchObject({ ancestorId: root.id });
  });

  it('reports only the node when its children are lifted', async () => {
    const root = await ctx.content.create(input('page', {}));
    const child = await ctx.content.create(input('page', {}, { parentId: root.id }));

    const deleted: string[] = [];
    const off = ctx.manablox.hooks.on('content:afterDelete', ({ id }) => {
      deleted.push(id);
    });
    expect(await ctx.content.delete(ctx.spaceId, root.id, null, 'reparent')).toBe(1);
    off();

    expect(deleted).toEqual([root.id]);
    expect((await ctx.content.get(ctx.spaceId, child.id))?.parentId).toBeNull();
  });
});
