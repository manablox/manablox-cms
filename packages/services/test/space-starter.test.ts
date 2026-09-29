import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applySpaceStarter } from '../src/space-starter.js';
import { createServiceContext, type ServiceContext } from '../src/testing.js';
import { TEST_TYPES } from './helpers/types.js';

/** No code types claiming the starter's names. */
let ctx: ServiceContext;
/** Global `teaser` and `article` collide with the starter. */
let crowded: ServiceContext;

beforeAll(async () => {
  [ctx, crowded] = await Promise.all([
    createServiceContext('space_starter', {
      fieldTypes: builtinFieldTypes,
      contentTypes: [{ name: 'landing', fields: [{ name: 'body', type: 'richtext' }] }],
    }),
    createServiceContext('space_starter_crowded', {
      fieldTypes: builtinFieldTypes,
      contentTypes: TEST_TYPES,
    }),
  ]);
});
afterAll(async () => {
  await Promise.all([ctx?.close(), crowded?.close()]);
});

const owner = (context: ServiceContext, email = 'owner@example.com') =>
  context.repos.users.create({
    name: 'Owner',
    email,
    role: 'superadmin',
    passwordHash: 'x',
  });

const website = (context: ServiceContext, ownerId: string, machineName = 'website') =>
  context.spaces.create(
    {
      name: 'Website',
      machineName,
      url: 'http://site',
      defaultLocale: 'de',
      locales: ['de', 'en'],
    },
    ownerId,
  );

describe('the basic setup', () => {
  it('fills a new space with a content model, published pages, a home page and a menu', async () => {
    const user = await owner(ctx);
    const space = await website(ctx, user.id);

    const result = await applySpaceStarter(ctx, space, { userId: user.id, roles: ['superadmin'] });
    expect(result).toMatchObject({ contentTypes: 3, contents: 4, menus: 1 });

    // Scoped to the new space only.
    const types = ctx.contentTypes.list(space.id).filter((type) => type.spaceId === space.id);
    expect(types.map((type) => type.name).sort()).toEqual(['article', 'page', 'teaser']);
    const teaser = types.find((type) => type.name === 'teaser');
    const page = types.find((type) => type.name === 'page');
    expect(teaser?.kind).toBe('block');
    expect(page?.fields.find((field) => field.name === 'components')?.settings).toEqual({
      types: [teaser?.id],
    });
    expect(ctx.contentTypes.list(ctx.spaceId).some((type) => type.spaceId === space.id)).toBe(
      false,
    );

    // Default locale, published, article under blog, attributed to the requester.
    const rows = (await ctx.content.list({ spaceId: space.id }, { limit: 50, offset: 0 })).items;
    expect(rows.map((row) => row.slug).sort()).toEqual(['about', 'blog', 'hello-world', 'home']);
    expect(rows.every((row) => row.locale === 'de')).toBe(true);
    expect(rows.every((row) => row.status === 'published')).toBe(true);
    const blog = rows.find((row) => row.slug === 'blog');
    const post = rows.find((row) => row.slug === 'hello-world');
    expect(post?.parentId).toBe(blog?.id);
    expect(post?.createdBy).toBe(user.id);

    // Two-column grid, one teaser per column.
    const home = rows.find((row) => row.slug === 'home');
    const components = home?.fields.components as {
      grid?: Record<string, { columns: number }>;
      blocks: { type: string; layout?: { column?: number } }[];
    };
    expect(components.grid).toEqual({
      desktop: { columns: 2 },
      tablet: { columns: 2 },
      mobile: { columns: 1 },
    });
    expect(components.blocks.map((block) => block.layout?.column)).toEqual([1, 2]);
    expect(components.blocks.every((block) => block.type === teaser?.id)).toBe(true);
    const about = rows.find((row) => row.slug === 'about');
    expect(about?.fields.components).toMatchObject({ blocks: [expect.any(Object)] });
    expect((about?.fields.components as { grid?: unknown }).grid).toBeUndefined();

    // The home page is the space's root.
    const saved = await ctx.repos.spaces.findById(space.id);
    expect(saved?.settings.homeContentId).toBe(result.homeContentId);
    expect(rows.find((row) => row.id === result.homeContentId)?.slug).toBe('home');

    // Resolvable by the name the guides use.
    const menu = await ctx.menus.resolve(space.id, 'main', 'de');
    expect(menu?.items.map((item) => item.label)).toEqual(['Home', 'About', 'Blog']);
  });

  it('refuses, before writing anything, when the instance defines one of its type names in code', async () => {
    const user = await owner(crowded);
    const space = await website(crowded, user.id);

    await expect(
      applySpaceStarter(crowded, space, { userId: user.id, roles: ['superadmin'] }),
    ).rejects.toMatchObject({
      key: 'space.starter.typeTaken',
      details: [{ params: { names: ['teaser', 'article'] } }],
    });

    expect(crowded.contentTypes.list(space.id).some((type) => type.spaceId === space.id)).toBe(
      false,
    );
    const rows = await crowded.content.list({ spaceId: space.id }, { limit: 5, offset: 0 });
    expect(rows.total).toBe(0);
    expect(await crowded.menus.list(space.id)).toEqual([]);
  });
});

describe('the other templates', () => {
  it.each([
    {
      template: 'blog' as const,
      types: ['blogroll', 'page', 'post'],
      documents: 6,
      menu: ['Home', 'Posts', 'About'],
    },
    {
      template: 'portfolio' as const,
      types: [
        'call-to-action',
        'contact',
        'gallery',
        'hero',
        'media-text',
        'message',
        'page',
        'project',
        'project-grid',
        'quote',
        'text',
      ],
      documents: 7,
      menu: ['Home', 'Work', 'About', 'Contact'],
    },
    {
      template: 'business' as const,
      types: [
        'call-to-action',
        'contact',
        'faq',
        'features',
        'hero',
        'message',
        'page',
        'service',
        'service-list',
        'stats',
        'team',
        'team-member',
        'testimonial',
        'testimonials',
        'text',
      ],
      documents: 11,
      menu: ['Home', 'Services', 'About', 'Contact'],
    },
    {
      template: 'landing' as const,
      types: [
        'call-to-action',
        'faq',
        'features',
        'hero',
        'media-text',
        'page',
        'pricing',
        'quote',
        'stats',
      ],
      documents: 2,
      menu: ['Home', 'Pricing'],
    },
    {
      template: 'custom' as const,
      blocks: ['gallery', 'hero', 'contact', 'testimonials'] as const,
      types: ['contact', 'gallery', 'hero', 'message', 'page', 'testimonial', 'testimonials'],
      documents: 4,
      menu: ['Home', 'Contact'],
    },
  ])(
    'fills a new space as the $template template',
    async ({ template, types, documents, menu, ...rest }) => {
      const user = await owner(ctx, `${template}@example.com`);
      const space = await website(ctx, user.id, template);

      const result = await applySpaceStarter(
        ctx,
        space,
        { userId: user.id, roles: ['superadmin'] },
        template,
        'blocks' in rest ? rest.blocks : undefined,
      );
      expect(result).toMatchObject({ contentTypes: types.length, contents: documents, menus: 1 });

      const own = ctx.contentTypes.list(space.id).filter((type) => type.spaceId === space.id);
      expect(own.map((type) => type.name).sort()).toEqual(types);
      const ids = new Set(own.map((type) => type.id));
      // Type names in settings became this space's ids.
      for (const type of own) {
        for (const field of type.fields) {
          const named = (field.settings as { types?: string[] }).types ?? [];
          expect(named.every((id) => ids.has(id))).toBe(true);
        }
      }

      const rows = (await ctx.content.list({ spaceId: space.id }, { limit: 50, offset: 0 })).items;
      expect(rows).toHaveLength(documents);
      expect(rows.every((row) => row.status === 'published')).toBe(true);
      const home = rows.find((row) => row.id === result.homeContentId);
      expect(home?.slug).toBe('home');

      // Blocks and references point at this space's types and documents.
      const rowIds = new Set(rows.map((row) => row.id));
      const blocks =
        (home?.fields.components as { blocks: { type: string; fields: object }[] } | undefined)
          ?.blocks ?? [];
      for (const block of blocks) {
        expect(ids.has(block.type)).toBe(true);
        for (const value of Object.values(block.fields)) {
          // Repeaters hold items; content fields hold document ids.
          if (Array.isArray(value) && value.every((entry) => typeof entry === 'string'))
            expect(value.every((id) => rowIds.has(id))).toBe(true);
        }
      }

      // Pages sit in menu order at the root.
      const roots = rows
        .filter((row) => row.permalink && !row.parentId)
        .sort((a, b) => a.position - b.position);
      expect(roots.map((row) => row.title)).toEqual(menu);

      const main = await ctx.menus.resolve(space.id, 'main', 'de');
      expect(main?.items.map((item) => item.label)).toEqual(menu);
    },
  );
});
