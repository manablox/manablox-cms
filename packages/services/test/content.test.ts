import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DeliveryReader } from '../src/delivery/index.js';
import { createLoaders } from '../src/loaders.js';
import { createServiceContext, type ServiceContext } from '../src/testing.js';
import { decoPlugin } from './helpers/deco.js';
import { TEST_TYPES } from './helpers/types.js';

let ctx: ServiceContext;

beforeAll(async () => {
  ctx = await createServiceContext('content', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
    config: { plugins: [decoPlugin] },
  });
});
afterAll(async () => {
  await ctx?.close();
});

const base = (over: Record<string, unknown> = {}) => ({
  spaceId: ctx.spaceId,
  typeId: ctx.ids.article as string,
  locale: 'en',
  title: 'Hello',
  fields: {},
  ...over,
});

describe('validation', () => {
  it('fills in defaults for fields the payload omits', async () => {
    const row = await ctx.content.create(base({ title: 'Defaults', slug: 'defaults' }));
    expect(row.fields.body).toEqual({ type: 'doc', content: [] });
    expect(row.fields.hero).toBeNull();
    expect(row.fields.components).toEqual({ blocks: [] });
  });

  it('stores rich text written as HTML as the document it describes', async () => {
    const row = await ctx.content.create(
      base({ title: 'From HTML', fields: { body: '<h2>Why</h2><p>It is <em>quick</em>.</p>' } }),
    );
    expect(row.fields.body).toEqual({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Why' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'It is ' },
            { type: 'text', text: 'quick', marks: [{ type: 'italic' }] },
            { type: 'text', text: '.' },
          ],
        },
      ],
    });
  });

  it('derives a slug from the title when none is given', async () => {
    const row = await ctx.content.create(base({ title: 'Grüße aus München!' }));
    expect(row.slug).toBe('gruesse-aus-muenchen');
  });

  it('reports every problem at once, with i18n keys and paths', async () => {
    const error = await ctx.content
      // A number is not valid rich text.
      .create(base({ title: '', slug: 'x', fields: { body: 42, hero: 'not-a-uuid' } }))
      .catch((err) => err);

    expect(error.kind).toBe('validation');
    const keys = error.details.map((d: { key: string }) => d.key);
    expect(keys).toContain('content.title.required');
    expect(error.details.some((d: { path?: unknown[] }) => d.path?.includes('hero'))).toBe(true);
    expect(error.details.length).toBeGreaterThanOrEqual(3);
  });

  it('validates nested blocks through the same path as top-level fields', async () => {
    const error = await ctx.content
      .create(
        base({
          title: 'Blocks',
          slug: 'blocks',
          fields: {
            components: {
              blocks: [
                { blockId: crypto.randomUUID(), type: ctx.ids.teaser, fields: { headline: 123 } },
              ],
            },
          },
        }),
      )
      .catch((err) => err);

    expect(error.kind).toBe('validation');
    expect(error.details[0].path).toEqual(['components', 0, 'headline']);
  });

  it('accepts a valid nested block', async () => {
    const row = await ctx.content.create(
      base({
        title: 'Good blocks',
        slug: 'good-blocks',
        fields: {
          components: {
            blocks: [
              {
                blockId: crypto.randomUUID(),
                type: ctx.ids.teaser,
                fields: { headline: 'Hi', image: null },
              },
            ],
          },
        },
      }),
    );
    expect((row.fields.components as { blocks: unknown[] }).blocks).toHaveLength(1);
  });

  it('rejects a block whose type is not a block type', async () => {
    const error = await ctx.content
      .create(
        base({
          title: 'Bad block',
          slug: 'bad-block',
          fields: {
            components: {
              blocks: [{ blockId: crypto.randomUUID(), type: ctx.ids.article, fields: {} }],
            },
          },
        }),
      )
      .catch((err) => err);
    expect(
      error.details.some((d: { key: string }) => d.key === 'content.block.type.notABlock'),
    ).toBe(true);
  });

  it('validates repeater items against their sub-fields, blocks inside included', async () => {
    const error = await ctx.content
      .create(
        base({
          title: 'Bad quotes',
          slug: 'bad-quotes',
          fields: {
            quotes: [
              { itemId: crypto.randomUUID(), fields: { quote: 'Fine' } },
              { itemId: crypto.randomUUID(), fields: { quote: '' } },
              {
                itemId: crypto.randomUUID(),
                fields: {
                  quote: 'Deep',
                  teaser: {
                    blockId: crypto.randomUUID(),
                    type: ctx.ids.teaser,
                    fields: { headline: 1 },
                  },
                },
              },
            ],
          },
        }),
      )
      .catch((err) => err);

    expect(error.kind).toBe('validation');
    expect(error.details.map((d: { path: unknown[] }) => d.path)).toEqual([
      ['quotes', 1, 'quote'],
      ['quotes', 2, 'teaser', 0, 'headline'],
    ]);
  });

  it('stores repeater items with defaults filled and unknown keys dropped', async () => {
    const itemId = crypto.randomUUID();
    const row = await ctx.content.create(
      base({
        title: 'Good quotes',
        slug: 'good-quotes',
        fields: { quotes: [{ itemId, fields: { quote: 'Searchable wisdom', ghost: 1 } }] },
      }),
    );
    expect(row.fields.quotes).toEqual([
      { itemId, fields: { quote: 'Searchable wisdom', photo: null, teaser: null } },
    ]);
    expect(row.searchText).toContain('Searchable wisdom');
  });

  it('drops values for fields that no longer exist on the type', async () => {
    const row = await ctx.content.create(
      base({ title: 'Stale', slug: 'stale', fields: { removedLongAgo: 'ghost' } }),
    );
    expect(row.fields.removedLongAgo).toBeUndefined();
  });

  it('assembles search text from every field type that contributes', async () => {
    const row = await ctx.content.create(
      base({
        title: 'Searchable',
        slug: 'searchable',
        fields: {
          body: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'needle' }] }],
          },
        },
      }),
    );
    expect(row.searchText).toContain('needle');

    const found = await ctx.content.list(
      { spaceId: ctx.spaceId, search: 'needle' },
      { limit: 10, offset: 0 },
    );
    expect(found.items.map((i) => i.id)).toContain(row.id);
  });
});

describe('field-level permissions', () => {
  const adminId = crypto.randomUUID();
  const editorId = crypto.randomUUID();

  it('hides read-restricted fields from an actor without the role', async () => {
    const row = await ctx.content.create(
      base({ title: 'Secretive', slug: 'secretive', fields: { secret: 'classified' } }),
      { userId: adminId, roles: ['admin'] },
    );

    const asAdmin = await ctx.content.get(ctx.spaceId, row.id, {
      actor: { userId: adminId, roles: ['admin'] },
    });
    const asEditor = await ctx.content.get(ctx.spaceId, row.id, {
      actor: { userId: editorId, roles: ['editor'] },
    });

    expect(asAdmin?.fields.secret).toBe('classified');
    expect(asEditor?.fields.secret).toBeUndefined();
  });

  it('keeps a write-restricted field intact when a client cannot see it', async () => {
    const row = await ctx.content.create(
      base({ title: 'Keep', slug: 'keep', fields: { secret: 'original' } }),
      { userId: adminId, roles: ['admin'] },
    );

    // The editor saves without the hidden field.
    await ctx.content.update(
      ctx.spaceId,
      row.id,
      base({ title: 'Keep', slug: 'keep', fields: {} }),
      {
        userId: editorId,
        roles: ['editor'],
      },
    );

    const after = await ctx.content.get(ctx.spaceId, row.id, {
      actor: { userId: adminId, roles: ['admin'] },
    });
    expect(after?.fields.secret).toBe('original');
  });
});

describe('references', () => {
  it('collects references from nested blocks as well as top-level fields', async () => {
    const assetId = crypto.randomUUID();
    const heroId = crypto.randomUUID();
    const row = await ctx.content.create(
      base({
        title: 'Refs',
        slug: 'refs',
        fields: {
          hero: heroId,
          components: {
            blocks: [
              {
                blockId: crypto.randomUUID(),
                type: ctx.ids.teaser,
                fields: { headline: 'x', image: assetId },
              },
            ],
          },
        },
      }),
    );

    const refs = ctx.content.collectReferences(row);
    expect(refs).toEqual(
      expect.arrayContaining([
        { target: 'asset', id: heroId },
        { target: 'asset', id: assetId },
      ]),
    );
  });

  it('collects references from repeater items and blocks inside them', async () => {
    const photoId = crypto.randomUUID();
    const imageId = crypto.randomUUID();
    const row = await ctx.content.create(
      base({
        title: 'Item refs',
        slug: 'item-refs',
        fields: {
          quotes: [
            {
              itemId: crypto.randomUUID(),
              fields: {
                quote: 'x',
                photo: photoId,
                teaser: {
                  blockId: crypto.randomUUID(),
                  type: ctx.ids.teaser,
                  fields: { image: imageId },
                },
              },
            },
          ],
        },
      }),
    );

    expect(ctx.content.collectReferences(row)).toEqual(
      expect.arrayContaining([
        { target: 'asset', id: photoId },
        { target: 'asset', id: imageId },
      ]),
    );
  });
});

describe('hooks', () => {
  it('lets a hook transform the payload before it is written', async () => {
    const off = ctx.manablox.hooks.on('content:beforeCreate', (payload) => ({
      ...payload,
      title: `${payload.title} (hooked)`,
    }));

    const row = await ctx.content.create(base({ title: 'Plain', slug: 'hooked' }));
    expect(row.title).toBe('Plain (hooked)');
    off();
  });

  it('runs afterPublish and emits a cache purge with content, type and space tags', async () => {
    const purges: string[][] = [];
    const off = ctx.manablox.hooks.on('cache:purge', (payload) => {
      purges.push(payload.tags);
    });

    const row = await ctx.content.create(base({ title: 'Pub', slug: 'pub' }));
    await ctx.content.publish(ctx.spaceId, row.id);

    expect(purges.at(-1)).toEqual([
      `content:${row.id}`,
      `type:${ctx.ids.article}`,
      `space:${ctx.spaceId}`,
      `asset-list:${ctx.spaceId}`,
    ]);
    off();
  });

  it('applies a per-row afterRead redaction to get, list and tree alike', async () => {
    const off = ctx.manablox.hooks.on('content:afterRead', (row) =>
      row?.slug === 'secret' ? { ...row, title: 'REDACTED' } : row,
    );
    const row = await ctx.content.create(base({ title: 'Secret', slug: 'secret' }));

    expect((await ctx.content.get(ctx.spaceId, row.id))?.title).toBe('REDACTED');
    const listed = await ctx.content.list({ spaceId: ctx.spaceId, ids: [row.id] }, page);
    expect(listed.items.map((item) => item.title)).toEqual(['REDACTED']);
    expect(titles(await ctx.content.tree(ctx.spaceId, 'en'))).toContain('REDACTED');
    off();
  });

  it('runs afterReadMany once per page and lets it drop rows, subtree included', async () => {
    const pages: number[] = [];
    const off = ctx.manablox.hooks.on('content:afterReadMany', (rows, context) => {
      pages.push(rows.length);
      expect(context.published).toBe(false);
      return rows.filter((item) => item.slug !== 'hidden-by-hook');
    });
    const parent = await ctx.content.create(base({ title: 'Hidden', slug: 'hidden-by-hook' }));
    const child = await ctx.content.create(
      base({ title: 'Hidden child', slug: 'hidden-child', parentId: parent.id }),
    );
    const visible = await ctx.content.create(base({ title: 'Visible', slug: 'visible' }));

    expect(await ctx.content.get(ctx.spaceId, parent.id)).toBeNull();
    expect((await ctx.content.get(ctx.spaceId, visible.id))?.id).toBe(visible.id);

    const listed = await ctx.content.list(
      { spaceId: ctx.spaceId, ids: [parent.id, child.id, visible.id] },
      page,
    );
    // The flat page loses only the parent; the tree below drops its subtree too.
    expect(listed.items.map((item) => item.id).sort()).toEqual([child.id, visible.id].sort());

    const tree = titles(await ctx.content.tree(ctx.spaceId, 'en'));
    expect(tree).toContain('Visible');
    expect(tree).not.toContain('Hidden');
    expect(tree).not.toContain('Hidden child');
    // One call per read: two gets, one list, one tree.
    expect(pages).toHaveLength(4);
    expect(pages.slice(0, 3)).toEqual([1, 1, 3]);
    off();
  });
});

const page = { limit: 50, offset: 0 };

function titles(nodes: Awaited<ReturnType<typeof ctx.content.tree>>): string[] {
  return nodes.flatMap((node) => [node.content.title, ...titles(node.children)]);
}

describe('duplicate', () => {
  it('copies the document beside the original, as a draft with a free slug', async () => {
    const original = await ctx.content.create(
      base({ title: 'Launch', slug: 'launch', fields: { body: { type: 'doc', content: [] } } }),
    );
    await ctx.content.publish(ctx.spaceId, original.id);

    const copy = await ctx.content.duplicate(ctx.spaceId, original.id);

    expect(copy.id).not.toBe(original.id);
    expect(copy.title).toBe('Launch (copy)');
    expect(copy.slug).toBe('launch-copy');
    expect(copy.status).toBe('draft');
    expect(copy.parentId).toBe(original.parentId);
    expect(copy.typeId).toBe(original.typeId);
    expect(copy.localizationId).not.toBe(original.localizationId);
  });

  it('counts up rather than colliding when the copy is copied', async () => {
    const original = await ctx.content.create(base({ title: 'Twice', slug: 'twice' }));
    const first = await ctx.content.duplicate(ctx.spaceId, original.id);
    const second = await ctx.content.duplicate(ctx.spaceId, first.id);
    const third = await ctx.content.duplicate(ctx.spaceId, original.id);

    expect(second.title).toBe('Twice (copy 2)');
    expect(new Set([first.slug, second.slug, third.slug]).size).toBe(3);
  });

  /** Copies must not share block ids. */
  it('gives every block a fresh id', async () => {
    const blockId = crypto.randomUUID();
    const original = await ctx.content.create(
      base({
        title: 'Blocky',
        slug: 'blocky',
        fields: {
          components: {
            blocks: [{ blockId, type: ctx.ids.teaser, fields: { headline: 'One', image: null } }],
          },
        },
      }),
    );

    const copy = await ctx.content.duplicate(ctx.spaceId, original.id);
    const blocks = (copy.fields.components as { blocks: { blockId: string }[] }).blocks;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.blockId).not.toBe(blockId);
  });

  it('gives every repeater item a fresh id', async () => {
    const itemId = crypto.randomUUID();
    const original = await ctx.content.create(
      base({
        title: 'Itemy',
        slug: 'itemy',
        fields: { quotes: [{ itemId, fields: { quote: 'A' } }] },
      }),
    );

    const copy = await ctx.content.duplicate(ctx.spaceId, original.id);
    const items = copy.fields.quotes as { itemId: string }[];
    expect(items).toHaveLength(1);
    expect(items[0]?.itemId).not.toBe(itemId);
  });

  it('leaves the children where they are unless asked for them', async () => {
    const parent = await ctx.content.create(base({ title: 'Docs', slug: 'docs' }));
    await ctx.content.create(base({ title: 'Intro', slug: 'intro', parentId: parent.id }));

    const copy = await ctx.content.duplicate(ctx.spaceId, parent.id);

    expect(titles(await ctx.content.tree(ctx.spaceId, 'en', copy.id))).toEqual([]);
    expect(titles(await ctx.content.tree(ctx.spaceId, 'en', parent.id))).toEqual(['Intro']);
  });

  it('copies the whole subtree under the copy, at any depth', async () => {
    const parent = await ctx.content.create(base({ title: 'Guide', slug: 'guide' }));
    const chapter = await ctx.content.create(
      base({ title: 'Chapter', slug: 'chapter', parentId: parent.id, position: 0 }),
    );
    await ctx.content.create(base({ title: 'Page', slug: 'page', parentId: chapter.id }));
    await ctx.content.create(
      base({ title: 'Appendix', slug: 'appendix', parentId: parent.id, position: 1 }),
    );

    const copy = await ctx.content.duplicate(ctx.spaceId, parent.id, null, { children: true });

    const nodes = await ctx.content.tree(ctx.spaceId, 'en', copy.id);
    expect(titles(nodes)).toEqual(['Chapter', 'Page', 'Appendix']);
    // Copies, not moves: the original keeps its subtree.
    expect(titles(await ctx.content.tree(ctx.spaceId, 'en', parent.id))).toEqual([
      'Chapter',
      'Page',
      'Appendix',
    ]);
    // A fresh parent has no sibling to clash with, so the slugs are kept.
    expect(nodes[0]?.content.slug).toBe('chapter');
    expect(nodes[0]?.children[0]?.content.slug).toBe('page');
  });
});

describe('block design', () => {
  const design = {
    variant: 'dark',
    style: { background: 'color:primary', paddingY: 'space:8', hide: ['mobile'] },
  };
  const components = (blockDesign: unknown = design) => ({
    blocks: [
      {
        blockId: crypto.randomUUID(),
        type: ctx.ids.teaser,
        fields: { headline: 'Styled', image: null },
        ext: { deco: blockDesign },
      },
    ],
  });
  const designOf = (fields: Record<string, unknown>) =>
    (fields.components as { blocks: { ext?: { deco?: unknown } }[] }).blocks[0]?.ext?.deco;

  it('keeps the design through save, publish, versions, restore, copies and translations', async () => {
    const row = await ctx.content.create(
      base({ title: 'Designed', slug: 'designed', fields: { components: components() } }),
    );
    expect(designOf(row.fields)).toEqual(design);

    const changed = { variant: 'compact' };
    const updated = await ctx.content.update(
      ctx.spaceId,
      row.id,
      base({ title: 'Designed', slug: 'designed', fields: { components: components(changed) } }),
    );
    expect(designOf(updated.fields)).toEqual(changed);

    await ctx.content.publish(ctx.spaceId, row.id);
    const published = await new DeliveryReader({
      manablox: ctx.manablox,
      repos: ctx.repos,
      loaders: createLoaders(ctx.repos, true),
      spaceId: ctx.spaceId,
      published: true,
    }).get(row.id);
    expect(designOf(published?.fields ?? {})).toEqual(changed);

    const first = await ctx.content.versionSnapshot(ctx.spaceId, row.id, 1, null);
    expect(designOf(first?.fields ?? {})).toEqual(design);
    const restored = await ctx.content.restore(ctx.spaceId, row.id, 1);
    expect(designOf(restored.fields)).toEqual(design);

    const copy = await ctx.content.duplicate(ctx.spaceId, row.id);
    expect(designOf(copy.fields)).toEqual(design);
    const translation = await ctx.content.createTranslation(ctx.spaceId, row.id, 'de');
    expect(designOf(translation.fields)).toEqual(design);
  });

  it('refuses a style outside the allow-list, pointing at the property', async () => {
    const error = await ctx.content
      .create(
        base({
          title: 'Bad style',
          slug: 'bad-style',
          fields: { components: components({ style: { background: '#f00' } }) },
        }),
      )
      .catch((err) => err);

    expect(error.kind).toBe('validation');
    expect(error.details[0].path).toEqual([
      'components',
      'blocks',
      0,
      'ext',
      'deco',
      'style',
      'background',
    ]);
  });

  it('keeps the stored design while its plugin is off, ignoring writes to it', async () => {
    const row = await ctx.content.create(
      base({ title: 'Kept', slug: 'kept', fields: { components: components() } }),
    );
    const blockId = (row.fields.components as { blocks: { blockId: string }[] }).blocks[0]
      ?.blockId as string;
    const withDesign = (value: unknown) => ({
      components: {
        blocks: [
          {
            blockId,
            type: ctx.ids.teaser,
            fields: { headline: 'Edited', image: null },
            ...(value === undefined ? {} : { ext: { deco: value } }),
          },
        ],
      },
    });
    const feature = ctx.manablox.controls.feature.bind(ctx.manablox.controls);
    const off = vi
      .spyOn(ctx.manablox.controls, 'feature')
      .mockImplementation(async (spaceId, key) =>
        key === 'plugins.deco' ? ({ enabled: false } as never) : feature(spaceId, key),
      );
    try {
      // Changed, removed or invalid: the stored design stays.
      for (const incoming of [{ variant: 'other' }, undefined, { style: { background: '#f00' } }]) {
        const saved = await ctx.content.update(
          ctx.spaceId,
          row.id,
          base({ title: 'Kept', slug: 'kept', fields: withDesign(incoming) }),
        );
        expect(designOf(saved.fields)).toEqual(design);
      }
      // A new document has nothing stored, so it gets no design.
      const created = await ctx.content.create(
        base({ title: 'Off', slug: 'off', fields: { components: components() } }),
      );
      expect(designOf(created.fields)).toBeUndefined();
      // Copies and translations keep what their source stored.
      const copy = await ctx.content.duplicate(ctx.spaceId, row.id);
      expect(designOf(copy.fields)).toEqual(design);
      const translation = await ctx.content.createTranslation(ctx.spaceId, row.id, 'de');
      expect(designOf(translation.fields)).toEqual(design);
    } finally {
      off.mockRestore();
    }
    // On again, the design is editable.
    const edited = await ctx.content.update(
      ctx.spaceId,
      row.id,
      base({ title: 'Kept', slug: 'kept', fields: withDesign({ variant: 'other' }) }),
    );
    expect(designOf(edited.fields)).toEqual({ variant: 'other' });
  });

  it('keeps stored data of plugins that are not loaded, ignoring writes to it', async () => {
    const created = await ctx.content.create(
      base({
        title: 'Unknown',
        slug: 'unknown',
        fields: {
          components: {
            blocks: components().blocks.map((b) => ({ ...b, ext: { ...b.ext, other: 1 } })),
          },
        },
      }),
    );
    const first = (fields: Record<string, unknown>) =>
      (fields.components as { blocks: { ext?: Record<string, unknown> }[] }).blocks[0];
    // Not stored yet, so the incoming entry is ignored.
    expect(first(created.fields)?.ext).toEqual({ deco: design });

    const stored = {
      components: {
        blocks: components().blocks.map((block, index) => ({
          ...block,
          blockId: (created.fields.components as { blocks: { blockId: string }[] }).blocks[index]
            ?.blockId,
          ext: { deco: design, other: { a: 1 } },
        })),
      },
    };
    await ctx.repos.content.update(created.id, {
      spaceId: ctx.spaceId,
      typeId: created.typeId,
      locale: created.locale,
      title: created.title,
      slug: created.slug,
      fields: stored,
      hasSlug: true,
    });
    const incoming = {
      components: {
        blocks: stored.components.blocks.map((block) => ({
          ...block,
          ext: { deco: { variant: 'compact' }, other: { a: 2 } },
        })),
      },
    };
    const saved = await ctx.content.update(
      ctx.spaceId,
      created.id,
      base({ title: 'Unknown', slug: 'unknown', fields: incoming }),
    );
    expect(first(saved.fields)?.ext).toEqual({ deco: { variant: 'compact' }, other: { a: 1 } });
  });
});

describe('space scoping', () => {
  it("treats another space's document as missing on every id-taking method", async () => {
    const row = await ctx.content.create(base({ title: 'Scoped', slug: 'scoped' }));
    const other = await ctx.repos.spaces.create({
      name: 'Elsewhere',
      machineName: 'content-elsewhere',
      url: 'http://elsewhere',
    });
    const notFound = { kind: 'not_found', key: 'content.notFound' };

    expect(await ctx.content.get(other.id, row.id)).toBeNull();
    const attempts: (() => Promise<unknown>)[] = [
      () => ctx.content.update(other.id, row.id, base({ spaceId: other.id, title: 'Taken' })),
      () => ctx.content.delete(other.id, row.id),
      () => ctx.content.publish(other.id, row.id),
      () => ctx.content.unpublish(other.id, row.id),
      () => ctx.content.schedule(other.id, row.id, { publishAt: null }),
      () => ctx.content.restore(other.id, row.id, 1),
      () => ctx.content.versions(other.id, row.id),
      () => ctx.content.versionSnapshot(other.id, row.id, 1),
      () => ctx.content.ancestorIds(other.id, row.id),
    ];
    for (const attempt of attempts) await expect(attempt()).rejects.toMatchObject(notFound);
    expect((await ctx.content.get(ctx.spaceId, row.id))?.title).toBe('Scoped');
  });

  it('strips read-restricted fields from a version snapshot', async () => {
    const admin = { userId: crypto.randomUUID(), roles: ['admin'] };
    const row = await ctx.content.create(
      base({ title: 'Versioned', slug: 'versioned', fields: { secret: 'classified' } }),
      admin,
    );
    await ctx.content.publish(ctx.spaceId, row.id, admin);
    const [latest] = (await ctx.content.versions(ctx.spaceId, row.id)).items;
    const version = latest?.version as number;

    const asAdmin = await ctx.content.versionSnapshot(ctx.spaceId, row.id, version, admin);
    const asEditor = await ctx.content.versionSnapshot(ctx.spaceId, row.id, version, {
      userId: crypto.randomUUID(),
      roles: ['editor'],
    });
    expect(asAdmin?.fields.secret).toBe('classified');
    expect(asEditor?.fields.secret).toBeUndefined();
  });
});

describe('read and field hooks', () => {
  it('runs beforeRead on get with the scope, and lets it refuse', async () => {
    const row = await ctx.content.create(base({ title: 'Guarded', slug: 'guarded' }));
    const seen: unknown[] = [];
    const off = ctx.manablox.hooks.on('content:beforeRead', (payload, context) => {
      seen.push({ id: payload.id, spaceId: context.spaceId, published: context.published });
      if (context.actor?.roles.includes('blocked')) throw new Error('refused');
    });

    expect((await ctx.content.get(ctx.spaceId, row.id))?.id).toBe(row.id);
    await expect(
      ctx.content.get(ctx.spaceId, row.id, { actor: { userId: 'u', roles: ['blocked'] } }),
    ).rejects.toThrow('refused');
    await ctx.content.list({ spaceId: ctx.spaceId, ids: [row.id] }, page);
    off();

    expect(seen).toEqual([
      { id: row.id, spaceId: ctx.spaceId, published: false },
      { id: row.id, spaceId: ctx.spaceId, published: false },
    ]);
  });

  it('runs afterList once per list page, after afterReadMany, and not for get or tree', async () => {
    const keep = await ctx.content.create(base({ title: 'Listed', slug: 'listed' }));
    const drop = await ctx.content.create(base({ title: 'Unlisted', slug: 'unlisted' }));
    const order: string[] = [];
    const offMany = ctx.manablox.hooks.on('content:afterReadMany', (rows) => {
      order.push('many');
      return rows;
    });
    const offList = ctx.manablox.hooks.on('content:afterList', (rows, context) => {
      order.push('list');
      expect(context.spaceId).toBe(ctx.spaceId);
      return rows.filter((row) => row.id !== drop.id);
    });

    const listed = await ctx.content.list({ spaceId: ctx.spaceId, ids: [keep.id, drop.id] }, page);
    expect(listed.items.map((item) => item.id)).toEqual([keep.id]);
    expect(order).toEqual(['many', 'list']);

    await ctx.content.get(ctx.spaceId, drop.id);
    await ctx.content.tree(ctx.spaceId, 'en');
    expect(order.filter((step) => step === 'list')).toHaveLength(1);
    offMany();
    offList();
  });

  const admin = { userId: crypto.randomUUID(), roles: ['admin'] };

  it('runs field:beforeValidate on each field, block fields included, before validation', async () => {
    const seen: string[] = [];
    const off = ctx.manablox.hooks.on('field:beforeValidate', (value, context) => {
      seen.push(`${context.contentType.name}.${context.field.name}`);
      if (context.field.name === 'headline' && typeof value === 'string') {
        return value.toUpperCase();
      }
      // A value for an absent field counts as supplied.
      if (context.field.name === 'secret' && value === undefined) return 'from hook';
    });

    const row = await ctx.content.create(
      base({
        title: 'Shouting',
        slug: 'shouting',
        fields: {
          components: {
            blocks: [
              { blockId: crypto.randomUUID(), type: ctx.ids.teaser, fields: { headline: 'hi' } },
            ],
          },
        },
      }),
      admin,
    );
    off();

    const [block] = (row.fields.components as { blocks: { fields: { headline: string } }[] })
      .blocks;
    expect(block?.fields.headline).toBe('HI');
    expect(row.fields.secret).toBe('from hook');
    expect(seen).toEqual(expect.arrayContaining(['article.body', 'teaser.headline']));
  });

  it('runs field:afterRead per top-level field before content:afterRead and read permissions', async () => {
    const row = await ctx.content.create(
      base({ title: 'Masked', slug: 'masked', fields: { secret: 'classified' } }),
      admin,
    );
    const offField = ctx.manablox.hooks.on('field:afterRead', (value, context) =>
      context.field.name === 'secret' ? `masked:${value}` : value,
    );
    const offRow = ctx.manablox.hooks.on('content:afterRead', (read) => {
      if (read?.id === row.id) expect(read.fields.secret).toBe('masked:classified');
      return read;
    });

    expect((await ctx.content.get(ctx.spaceId, row.id, { actor: admin }))?.fields.secret).toBe(
      'masked:classified',
    );
    const listed = await ctx.content.list({ spaceId: ctx.spaceId, ids: [row.id] }, page, [], {
      actor: admin,
    });
    expect(listed.items[0]?.fields.secret).toBe('masked:classified');
    const asEditor = await ctx.content.get(ctx.spaceId, row.id, {
      actor: { userId: 'e', roles: ['editor'] },
    });
    expect(asEditor?.fields.secret).toBeUndefined();
    offField();
    offRow();

    const stored = await ctx.repos.content.findById(row.id);
    expect(stored?.fields.secret).toBe('classified');
  });
});

describe('tree reads', () => {
  it('applies read permissions and drops unreadable types like hidden ones', async () => {
    const admin = { userId: crypto.randomUUID(), roles: ['admin'] };
    const editor = { userId: crypto.randomUUID(), roles: ['editor'] };
    const row = await ctx.content.create(
      base({ title: 'Tree secret', slug: 'tree-secret', fields: { secret: 'classified' } }),
      admin,
    );
    const find = (nodes: Awaited<ReturnType<typeof ctx.content.tree>>) =>
      nodes.find((node) => node.content.id === row.id)?.content;

    expect(
      find(await ctx.content.tree(ctx.spaceId, 'en', null, { actor: admin }))?.fields.secret,
    ).toBe('classified');
    expect(
      find(await ctx.content.tree(ctx.spaceId, 'en', null, { actor: editor }))?.fields,
    ).not.toHaveProperty('secret');
    expect(find(await ctx.content.tree(ctx.spaceId, 'en', null, { typeIds: [] }))).toBeUndefined();

    const level = await ctx.content.treeChildren(ctx.spaceId, 'en', null, {
      limit: 200,
      actor: editor,
    });
    const child = level.items.find((item) => item.content.id === row.id);
    expect(child?.content.fields).not.toHaveProperty('secret');
    const narrowed = await ctx.content.treeChildren(ctx.spaceId, 'en', null, {
      limit: 200,
      typeIds: [],
    });
    expect(narrowed.items).toEqual([]);
  });
});
