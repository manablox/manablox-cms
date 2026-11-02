import { SPACE_BLOCK_IDS, SPACE_TEMPLATE_IDS, type SpaceBlockId } from '@manablox/core';
import { builtinFieldTypes } from '@manablox/fields';
import { applySpaceStarter } from '@manablox/services';
import {
  DESIGN_PRESETS,
  findBrokenBindings,
  type SiteDesignData,
  validateSiteDesign,
} from '@manablox/site';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { websiteRepos } from '../../src/server/db/index.js';
import type { SiteThemeService } from '../../src/server/services/theme.service.js';
import { createWebsiteContext, type WebsiteContext } from '../helpers/context.js';

let ctx: WebsiteContext;
let themes: SiteThemeService;

beforeAll(async () => {
  ctx = await createWebsiteContext('design_presets', {
    fieldTypes: builtinFieldTypes,
    contentTypes: [],
  });
  themes = ctx.website.themes;
});
afterAll(async () => {
  await ctx?.close();
});

let counter = 0;
const templated = async (
  template: (typeof SPACE_TEMPLATE_IDS)[number],
  blocks?: readonly SpaceBlockId[],
) => {
  const name = `${template}-${++counter}`;
  const owner = await ctx.repos.users.create({
    name: 'Owner',
    email: `${name}@example.com`,
    role: 'superadmin',
    passwordHash: 'x',
  });
  const space = await ctx.spaces.create(
    { name, machineName: name, url: 'http://site', defaultLocale: 'de' },
    owner.id,
  );
  await applySpaceStarter(
    ctx,
    space,
    { userId: owner.id, roles: ['superadmin'] },
    template,
    blocks,
  );
  return space.id;
};

describe('design presets', () => {
  it.each([
    ...SPACE_TEMPLATE_IDS.map((template) => ({ template, blocks: undefined })),
    { template: 'custom' as const, blocks: SPACE_BLOCK_IDS },
  ])('design every type of the $template template $blocks', async ({ template, blocks }) => {
    const spaceId = await templated(template, blocks);
    const types = ctx.contentTypes
      .list(spaceId)
      .filter((type) => type.spaceId === spaceId && type.kind !== 'data');

    for (const preset of DESIGN_PRESETS) {
      const report = await themes.applyStarter(spaceId, 'builtin:studio', {
        preset: preset.id,
        replace: true,
      });
      expect(report.entries.filter((entry) => entry.action === 'skip')).toEqual([]);
      expect(report.entries.filter((entry) => entry.brokenBindings)).toEqual([]);

      const rows = await websiteRepos(ctx.repos).designs.listBySpace(spaceId);
      const keys = rows.map((row) => `${row.kind}:${row.key}`);
      expect(keys).toEqual(
        expect.arrayContaining([
          'theme:default',
          'layout:default',
          'menu:main',
          'menu:footer',
          ...types.map((type) => `${type.kind === 'block' ? 'block' : 'page'}:${type.id}`),
        ]),
      );
      for (const row of rows) {
        const result = validateSiteDesign(row.kind, row.draft);
        expect(result.ok ? [] : result.issues).toEqual([]);
        const type = types.find((entry) => entry.id === row.key);
        if (type && (row.kind === 'block' || row.kind === 'page'))
          expect(findBrokenBindings(row.draft as SiteDesignData<'block' | 'page'>, type)).toEqual(
            [],
          );
      }
    }
  });

  it('binds fields of related documents by field id and name', async () => {
    const spaceId = await templated('business');
    await themes.applyStarter(spaceId, 'builtin:neutral', { preset: 'atlas', replace: true });
    const type = ctx.contentTypes.list(spaceId).find((entry) => entry.name === 'testimonials');
    const items = type?.fields.find((field) => field.name === 'items');
    const row = await websiteRepos(ctx.repos).designs.find(spaceId, 'block', type?.id as string);
    const json = JSON.stringify(row?.draft);
    expect(json).toContain(`"field":"${items?.id}.quote"`);
    expect(json).toContain(`"field":"${items?.id}.$item"`);
  });

  it('refuses an unknown preset', async () => {
    const spaceId = await templated('blog');
    await expect(
      themes.applyStarter(spaceId, 'builtin:neutral', { preset: 'nope' }),
    ).rejects.toMatchObject({ key: 'plugins.website.theme.preset.notFound' });
  });
});
