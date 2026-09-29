import { ManabloxError } from '@manablox/core';
import { TEST_DIALECT } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceContext, type ServiceContext } from '../src/testing.js';

let ctx: ServiceContext;
let spaceId: string;

beforeAll(async () => {
  ctx = await createServiceContext('content_type_plan', {
    fieldTypes: builtinFieldTypes,
    contentTypes: [],
  });
  const owner = await ctx.repos.users.create({
    name: 'Owner',
    email: 'owner@example.com',
    role: 'superadmin',
    passwordHash: 'x',
  });
  const space = await ctx.spaces.create(
    { name: 'Plans', machineName: 'plans', url: 'https://plans.example.com' },
    owner.id,
  );
  spaceId = space.id;
});
afterAll(async () => {
  await ctx?.close();
});

const names = () => ctx.contentTypes.list(spaceId).map((type) => type.name);

describe('contentTypes.applyPlan', () => {
  it('creates a document and the blocks it names, block types first', async () => {
    const created = await ctx.contentTypes.applyPlan(spaceId, {
      types: [
        {
          name: 'landing_page',
          kind: 'content',
          fields: [
            { name: 'teaser', type: 'string' },
            { name: 'sections', type: 'blocks', settings: { types: ['hero', 'faq'] } },
          ],
        },
        { name: 'hero', kind: 'block', fields: [{ name: 'heading', type: 'string' }] },
        { name: 'faq', kind: 'block', fields: [{ name: 'question', type: 'string' }] },
      ],
    });

    expect(created.map((type) => type.name)).toEqual(['hero', 'faq', 'landing_page']);
    const page = created.find((type) => type.name === 'landing_page');
    const hero = created.find((type) => type.name === 'hero');
    const faq = created.find((type) => type.name === 'faq');
    expect(page?.fields.find((field) => field.name === 'sections')?.settings.types).toEqual([
      hero?.id,
      faq?.id,
    ]);
    expect(hero?.kind).toBe('block');
    expect(hero?.hasSlug).toBe(false);
  });

  it('refers to a type that already exists by its name', async () => {
    const [article] = await ctx.contentTypes.applyPlan(spaceId, {
      types: [
        {
          name: 'article',
          kind: 'content',
          fields: [
            { name: 'body', type: 'blocks', settings: { types: ['hero'] } },
            { name: 'related', type: 'content', settings: { types: ['landing_page'] } },
          ],
        },
      ],
    });
    const hero = ctx.contentTypes.list(spaceId).find((type) => type.name === 'hero');
    const page = ctx.contentTypes.list(spaceId).find((type) => type.name === 'landing_page');
    expect(article?.fields[0]?.settings.types).toEqual([hero?.id]);
    expect(article?.fields[1]?.settings.types).toEqual([page?.id]);
  });

  it('creates a databag and drops its tree flags', async () => {
    const created = await ctx.contentTypes.applyPlan(spaceId, {
      types: [
        {
          name: 'author',
          kind: 'data',
          hasSlug: true,
          isVisibleInTree: true,
          isPublishable: false,
          fields: [{ name: 'bio', type: 'string' }],
        },
        {
          name: 'essay',
          kind: 'content',
          fields: [{ name: 'author', type: 'content', settings: { types: ['author'] } }],
        },
      ],
    });
    const author = created.find((type) => type.name === 'author');
    expect(author).toMatchObject({ kind: 'data', hasSlug: false, isVisibleInTree: false });
    expect(author?.isPublishable).toBe(false);
    const essay = created.find((type) => type.name === 'essay');
    expect(essay?.fields[0]?.settings.types).toEqual([author?.id]);
  });

  it('creates blocks that embed each other', async () => {
    const created = await ctx.contentTypes.applyPlan(spaceId, {
      types: [
        {
          name: 'columns',
          kind: 'block',
          fields: [{ name: 'items', type: 'blocks', settings: { types: ['card'] } }],
        },
        {
          name: 'card',
          kind: 'block',
          fields: [
            { name: 'title', type: 'string' },
            { name: 'nested', type: 'blocks', settings: { types: ['columns'] } },
          ],
        },
      ],
    });
    const columns = created.find((type) => type.name === 'columns');
    const card = created.find((type) => type.name === 'card');
    expect(columns?.fields[0]?.settings.types).toEqual([card?.id]);
    expect(card?.fields.map((field) => field.name)).toEqual(['title', 'nested']);
    expect(card?.fields[1]?.settings.types).toEqual([columns?.id]);
  });

  it('refuses the whole plan when a reference goes nowhere, creating nothing', async () => {
    const before = names();
    const error = await ctx.contentTypes
      .applyPlan(spaceId, {
        types: [
          { name: 'quote', kind: 'block', fields: [{ name: 'text', type: 'string' }] },
          {
            name: 'story',
            kind: 'content',
            fields: [{ name: 'body', type: 'blocks', settings: { types: ['quote', 'gallery'] } }],
          },
        ],
      })
      .catch((err: unknown) => err);

    expect(ManabloxError.is(error) && error.kind).toBe('validation');
    expect((error as ManabloxError).details).toContainEqual(
      expect.objectContaining({
        key: 'contentType.plan.reference.unknown',
        path: ['types', 1, 'fields', 0, 'settings', 'types'],
        params: { name: 'gallery' },
      }),
    );
    expect(names()).toEqual(before);
  });

  it('refuses a block field that names a document type', async () => {
    const error = await ctx.contentTypes
      .applyPlan(spaceId, {
        types: [
          {
            name: 'wrong',
            kind: 'content',
            fields: [{ name: 'body', type: 'blocks', settings: { types: ['article'] } }],
          },
        ],
      })
      .catch((err: unknown) => err);
    expect((error as ManabloxError).details[0]?.key).toBe('contentType.plan.reference.wrongKind');
  });

  it('refuses a name that is taken, and settings the field type refuses', async () => {
    const error = await ctx.contentTypes
      .applyPlan(spaceId, {
        types: [
          { name: 'hero', kind: 'block', fields: [] },
          {
            name: 'bad_settings',
            kind: 'content',
            fields: [{ name: 'count', type: 'number', settings: { min: 'lots' } }],
          },
        ],
      })
      .catch((err: unknown) => err);
    const details = (error as ManabloxError).details;
    expect(details).toContainEqual(
      expect.objectContaining({ key: 'contentType.name.duplicate', path: ['types', 0, 'name'] }),
    );
    expect(details.some((detail) => detail.path?.[0] === 'types' && detail.path[1] === 1)).toBe(
      true,
    );
    expect(names()).not.toContain('bad_settings');
  });
});

describe('types written inside an open transaction', () => {
  const page = (name: string) => ({
    name,
    spaceId,
    kind: 'content' as const,
    fields: [{ name: 'body', type: 'string' }],
  });
  const registered = (id: string) => ctx.manablox.contentTypes.tryGet(id) !== undefined;

  it('stay in the registry while the committed types are reloaded, as a sync does', async () => {
    const id = await ctx.repos.transaction(async (tx) => {
      const types = ctx.contentTypes.using(tx);
      const { id } = await types.create(page('staged_page'), null);
      await ctx.manablox.reload(await ctx.repos.contentTypes.listAll(), { synced: true });
      expect(registered(id)).toBe(true);
      // Later writes in the transaction still find it.
      await types.create({ ...page('staged_other'), fields: [] }, null);
      return id;
    });
    expect(registered(id)).toBe(true);
    expect(names()).toEqual(expect.arrayContaining(['staged_page', 'staged_other']));
  });

  it('leave the registry when the transaction rolls back', async () => {
    let id = '';
    await expect(
      ctx.repos.transaction(async (tx) => {
        ({ id } = await ctx.contentTypes.using(tx).create(page('rolled_page'), null));
        expect(registered(id)).toBe(true);
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');
    expect(registered(id)).toBe(false);
  });

  // SQLite runs one write transaction at a time.
  it.skipIf(TEST_DIALECT === 'sqlite')('of two transactions stay side by side', async () => {
    let first = '';
    let staged = () => {};
    const firstStaged = new Promise<void>((resolve) => {
      staged = resolve;
    });
    let release = () => {};
    const secondDone = new Promise<void>((resolve) => {
      release = resolve;
    });
    const one = ctx.repos.transaction(async (tx) => {
      ({ id: first } = await ctx.contentTypes.using(tx).create(page('side_one'), null));
      staged();
      await secondDone;
      expect(registered(first)).toBe(true);
    });
    await firstStaged;
    const second = await ctx.repos.transaction(async (tx) => {
      const { id } = await ctx.contentTypes.using(tx).create(page('side_two'), null);
      expect(registered(first)).toBe(true);
      return id;
    });
    release();
    await one;
    expect(registered(first) && registered(second)).toBe(true);
  });
});
