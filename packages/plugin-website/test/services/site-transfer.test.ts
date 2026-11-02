import { builtinFieldTypes } from '@manablox/fields';
import { SPACE_EXPORT_VERSION, type SpaceExport } from '@manablox/services';
import {
  defaultSiteSettings,
  defaultTheme,
  generateBlockDesign,
  generatePageDesign,
} from '@manablox/site';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { websiteRepos } from '../../src/server/db/index.js';
import type { ExportedSiteDesign } from '../../src/server/transfer.js';
import { createWebsiteContext, type WebsiteContext } from '../helpers/context.js';
import { TEST_TYPES } from '../helpers/types.js';

let ctx: WebsiteContext;
let ownerId: string;
let source: string;

beforeAll(async () => {
  ctx = await createWebsiteContext('site_transfer', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
  });
  ownerId = (
    await ctx.repos.users.create({
      name: 'Importer',
      email: 'site-importer@example.com',
      role: 'editor',
      passwordHash: 'x',
    })
  ).id;

  source = (
    await ctx.repos.spaces.create({ name: 'Site', machineName: 'site_src', url: 'http://s.test' })
  ).id;
  const teaser = ctx.ids.teaser as string;
  const article = ctx.ids.article as string;
  const types = ctx.manablox.contentTypes;
  // Published, then changed again: both copies travel.
  await ctx.website.designs.saveDraft(source, {
    kind: 'theme',
    key: 'default',
    draft: defaultTheme(),
  });
  await ctx.website.designs.saveDraft(source, {
    kind: 'block',
    key: teaser,
    draft: generateBlockDesign(types.get(teaser)),
  });
  await ctx.website.designs.saveDraft(source, {
    kind: 'site',
    key: 'default',
    draft: { ...defaultSiteSettings(), name: 'Live', layouts: { [article]: 'default' } },
  });
  await ctx.website.designs.publishAll(source);
  const theme = await ctx.website.designs.get(source, 'theme', 'default');
  const changed = defaultTheme();
  changed.colors.roles.primary = '#ff0000';
  await ctx.website.designs.saveDraft(source, {
    kind: 'theme',
    key: 'default',
    draft: changed,
    expectedVersion: theme.design?.version,
  });
  // Never published.
  await ctx.website.designs.saveDraft(source, {
    kind: 'page',
    key: article,
    draft: generatePageDesign(types.get(article)),
  });
  await ctx.website.domains.create(source, { hostname: 'transfer.example.com' });
  await ctx.redirects.create(source, { fromPath: '/old', toPath: '/new', status: 302 });
});
afterAll(async () => {
  await ctx?.close();
});

const designsOf = (payload: SpaceExport) =>
  (payload.plugins?.['website.designs'] ?? []) as ExportedSiteDesign[];

/** The payload under a new space identity, for importing into the same instance. */
const asCopy = (payload: SpaceExport, machineName: string): SpaceExport => ({
  ...payload,
  space: { ...payload.space, id: crypto.randomUUID(), machineName, name: machineName },
});

describe('site sections of a space transfer', () => {
  it('exports designs with both copies, domains and redirects', async () => {
    const payload = await ctx.spaces.export(source);
    expect(payload.manabloxSpaceExport).toBe(SPACE_EXPORT_VERSION);
    expect(payload.sections).toEqual(
      expect.arrayContaining(['website.designs', 'website.domains', 'redirects']),
    );
    const theme = designsOf(payload).find((design) => design.kind === 'theme');
    expect(theme).toMatchObject({ changed: true, published: expect.any(Object) });
    expect(designsOf(payload).find((design) => design.kind === 'page')).toMatchObject({
      published: null,
      changed: false,
      type: { name: 'article' },
    });
    expect(payload.plugins?.['website.domains']).toEqual([
      { hostname: 'transfer.example.com', locale: null, isPrimary: true, redirectToPrimary: false },
    ]);
    expect(payload.redirects).toEqual([
      expect.objectContaining({ fromPath: '/old', toPath: '/new', status: 302, source: 'manual' }),
    ]);
    const inventory = await ctx.spaces.inventory(source);
    expect(inventory).toMatchObject({
      redirects: 1,
      plugins: { 'website.designs': 4, 'website.domains': 1 },
    });
  });

  it('restores designs as they were and leaves domains out unless asked', async () => {
    const copy = asCopy(await ctx.spaces.export(source), 'site_copy');
    const result = await ctx.spaces.import(copy, ownerId);
    const spaceId = copy.space.id;
    expect(result.sections).not.toContain('website.domains');
    expect(result).toMatchObject({
      redirects: 1,
      plugins: { 'website.designs': 4, 'website.domains': 0 },
    });

    const list = await ctx.website.designs.list(spaceId);
    const status = (kind: string) => list.find((entry) => entry.kind === kind)?.status;
    expect(status('theme')).toBe('changed');
    expect(status('block')).toBe('published');
    expect(status('page')).toBe('unpublished');
    expect(status('site')).toBe('published');
    const theme = await ctx.website.designs.get(spaceId, 'theme', 'default');
    expect((theme.data as ReturnType<typeof defaultTheme>).colors.roles.primary).toBe('#ff0000');
    // The live copy is the design's only version.
    expect(await ctx.website.designs.versions(spaceId, theme.design?.id as string)).toHaveLength(1);
    // Settings travel with the space; the revision the site renders stays.
    expect((await ctx.website.settings.get(spaceId)).revision).toBe(1);

    expect(await websiteRepos(ctx.repos).domains.listBySpace(spaceId)).toEqual([]);
    const redirect = await ctx.repos.redirects.findByPath(spaceId, null, '/old');
    expect(redirect).toMatchObject({ toPath: '/new', status: 302 });
  });

  it('imports domains when named, skipping host names in use', async () => {
    const copy = asCopy(await ctx.spaces.export(source), 'site_domains');
    const result = await ctx.spaces.import(copy, ownerId, {
      sections: ['website.designs', 'website.domains'],
    });
    expect(result.sections).toEqual(['website.designs', 'website.domains']);
    expect(result.notes).toContain(
      'The domain transfer.example.com was skipped: another space uses it.',
    );
    expect(await websiteRepos(ctx.repos).domains.listBySpace(copy.space.id)).toEqual([]);
  });

  it('matches block and page designs by type name and skips unknown types', async () => {
    const payload = await ctx.spaces.export(source, { sections: ['website.designs'] });
    const copy = asCopy(payload, 'site_types');
    copy.plugins = {
      'website.designs': designsOf(copy).flatMap((design) => {
        if (design.kind !== 'block') return [design];
        return [
          // A type id this instance does not know, but a name it does.
          { ...design, key: crypto.randomUUID(), type: { ...design.type, id: undefined } as never },
          { ...design, key: crypto.randomUUID(), type: { name: 'missing_block' } },
        ];
      }),
    };
    const result = await ctx.spaces.import(copy, ownerId);
    expect(result.notes).toContain(
      'The block design for "missing_block" was skipped: the type is missing.',
    );
    const row = await websiteRepos(ctx.repos).designs.find(
      copy.space.id,
      'block',
      ctx.ids.teaser as string,
    );
    expect(row?.published).not.toBeNull();
  });

  it('carries the website settings along', async () => {
    await ctx.website.settings.set(source, { mode: 'designed', localeStrategy: 'domain' });
    const copy = asCopy(await ctx.spaces.export(source), 'site_settings');
    expect(copy.pluginSettings?.website).toMatchObject({ mode: 'designed' });
    await ctx.spaces.import(copy, ownerId);
    expect(await ctx.website.settings.get(copy.space.id)).toMatchObject({
      mode: 'designed',
      localeStrategy: 'domain',
    });
  });

  it('skips sections no plugin handles, with a note', async () => {
    const payload = await ctx.spaces.export(source, { sections: ['menus'] });
    const copy = asCopy(payload, 'site_unknown');
    copy.sections = [...copy.sections, 'gone.things'];
    copy.plugins = { 'gone.things': [{ id: 'x' }] };
    const result = await ctx.spaces.import(copy, ownerId);
    expect(result.sections).not.toContain('gone.things');
    expect(result.notes).toContain(
      'The section gone.things was skipped: no plugin here handles it.',
    );
  });
});
