import type { ContentTypeInput } from '@manablox/core';
import { builtinFieldTypes } from '@manablox/fields';
import {
  type BlockDesign,
  defaultSiteSettings,
  defaultTheme,
  generateBlockDesign,
  type ThemeBundle,
} from '@manablox/site';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { websiteRepos } from '../../src/server/db/index.js';
import { buildDesignBundle } from '../../src/server/services/site/designs.js';
import { defineTheme } from '../../src/server/theme-define.js';
import { createWebsiteContext, type WebsiteContext } from '../helpers/context.js';
import { TEST_TYPES } from '../helpers/types.js';

const heroDesign: BlockDesign = {
  default: 'default',
  variants: {
    default: {
      label: 'Default',
      root: { id: 'root', el: 'section', children: [{ id: 'title', el: 'heading' }] },
    },
  },
};

import { assertThemesValid, themeProblems } from '../../src/server/services/theme/code.js';
import type { SiteThemeService } from '../../src/server/services/theme.service.js';

const TYPES: ContentTypeInput[] = [
  ...TEST_TYPES,
  {
    name: 'hero',
    kind: 'block',
    fields: [{ name: 'title', type: 'string' }],
    plugins: { website: heroDesign },
  },
];

const acme = defineTheme({
  id: 'acme',
  name: 'Acme',
  // Every space these tests create except `elsewhere`.
  spaces: [...'abcdefghijklmnopqrstuvwxyz'].map((letter) => `site-${letter}`),
  theme: defaultTheme(),
  designs: [
    { kind: 'block', key: 'teaser', data: generateBlockDesign({ fields: [] }) },
    { kind: 'menu', key: 'main', data: starterMenu() },
  ],
  site: { ...defaultSiteSettings(), name: 'Acme', headCode: '<meta name="acme">' },
});

let ctx: WebsiteContext;
let themes: SiteThemeService;

beforeAll(async () => {
  ctx = await createWebsiteContext('site_theme', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TYPES,
    website: { themes: [acme] },
  });
  themes = ctx.website.themes;
});
afterAll(async () => {
  await ctx?.close();
});

let counter = 0;
const freshSpace = async (name = `site-${String.fromCharCode(97 + counter++)}`) =>
  (await ctx.repos.spaces.create({ name, machineName: name, url: 'http://t.test' })).id;

function starterMenu() {
  return {
    preset: 'bar' as const,
    depth: 1,
    levels: [{}],
    mobile: { behaviour: 'none' as const, breakpoint: 'mobile' as const },
  };
}

describe('theme bundles', () => {
  it('exports stored designs with their types and imports them as drafts elsewhere', async () => {
    const from = await freshSpace();
    const teaser = ctx.ids.teaser as string;
    const teaserDesign = generateBlockDesign(ctx.manablox.contentTypes.get(teaser));
    await ctx.website.designs.saveDraft(from, { kind: 'block', key: teaser, draft: teaserDesign });
    await ctx.website.designs.saveDraft(from, {
      kind: 'site',
      key: 'default',
      draft: { ...defaultSiteSettings(), name: 'From', customCss: 'body{color:red}' },
    });
    await ctx.website.designs.publishAll(from);
    // A draft change after publishing stays out of a published export.
    const stored = await ctx.website.designs.get(from, 'site', 'default');
    await ctx.website.designs.saveDraft(from, {
      kind: 'site',
      key: 'default',
      draft: { ...defaultSiteSettings(), name: 'Draft name' },
      expectedVersion: stored.design?.version,
    });

    const bundle = await themes.exportBundle(from);
    expect(bundle.format).toBe('manablox-theme');
    expect(bundle.site?.name).toBe('From');
    // Code needs the exporter's `design:code`.
    expect(bundle.site?.customCss).toBeUndefined();
    expect(bundle.designs).toEqual([
      expect.objectContaining({
        kind: 'block',
        key: teaser,
        type: expect.objectContaining({ name: 'teaser' }),
      }),
    ]);
    expect((await themes.exportBundle(from, { variant: 'draft' })).site?.name).toBe('Draft name');
    expect((await themes.exportBundle(from, { includeCode: true })).site?.customCss).toBe(
      'body{color:red}',
    );

    const to = await freshSpace();
    const preview = await themes.previewImport(to, bundle);
    expect(preview.entries.map((entry) => [entry.kind, entry.action])).toEqual([
      ['theme', 'create'],
      ['site', 'create'],
      ['block', 'create'],
    ]);
    expect(await websiteRepos(ctx.repos).designs.listBySpace(to)).toEqual([]);

    const report = await themes.importBundle(to, bundle, {}, null);
    expect(report.entries.every((entry) => entry.action === 'create')).toBe(true);
    const rows = await websiteRepos(ctx.repos).designs.listBySpace(to);
    expect(rows.map((row) => `${row.kind}:${row.key}`).sort()).toEqual(
      [`block:${teaser}`, 'site:default', 'theme:default'].sort(),
    );
    // Imported designs are drafts.
    expect(rows.every((row) => row.published === null)).toBe(true);

    // A second import replaces, unless told to keep or skip.
    const again = await themes.previewImport(to, bundle, { skip: ['theme:default'] });
    expect(again.entries.map((entry) => [entry.kind, entry.action, entry.reason])).toEqual([
      ['theme', 'skip', 'excluded'],
      ['site', 'replace', undefined],
      ['block', 'replace', undefined],
    ]);
    const kept = await themes.previewImport(to, bundle, { replace: false });
    expect(kept.entries.every((entry) => entry.reason === 'exists')).toBe(true);
  });

  it('finds block types by name, rebinds their fields and skips unknown ones', async () => {
    const to = await freshSpace();
    const teaser = ctx.manablox.contentTypes.get(ctx.ids.teaser as string);
    const headline = teaser.fields.find((f) => f.name === 'headline')?.id as string;
    const design: BlockDesign = {
      default: 'default',
      variants: {
        default: {
          label: 'Default',
          root: {
            id: 'root',
            el: 'stack',
            children: [{ id: 'h', el: 'heading', bind: { field: 'elsewhere-headline' } }],
          },
        },
      },
    };
    const bundle: ThemeBundle = {
      format: 'manablox-theme',
      version: 1,
      designs: [
        {
          kind: 'block',
          key: 'f8a7b1c6-0000-4000-8000-000000000000',
          type: { name: 'teaser', fields: { 'elsewhere-headline': 'headline' } },
          data: design,
        },
        {
          kind: 'block',
          key: 'gone',
          type: { name: 'no_such_block' },
          data: design,
        },
      ],
    };
    const report = await themes.importBundle(to, bundle);
    expect(report.entries).toEqual([
      expect.objectContaining({ kind: 'block', key: teaser.id, action: 'create' }),
      expect.objectContaining({ kind: 'block', action: 'skip', reason: 'unknownType' }),
    ]);
    const row = await websiteRepos(ctx.repos).designs.find(to, 'block', teaser.id);
    expect(JSON.stringify(row?.draft)).toContain(headline);
  });

  it('keeps the space code fields when the importer lacks design:code', async () => {
    const to = await freshSpace();
    await ctx.website.designs.saveDraft(to, {
      kind: 'site',
      key: 'default',
      draft: { ...defaultSiteSettings(), headCode: '<meta name="mine">' },
    });
    const bundle: ThemeBundle = {
      format: 'manablox-theme',
      version: 1,
      designs: [],
      site: { ...defaultSiteSettings(), name: 'New', headCode: '<script>x</script>' },
    };

    const report = await themes.importBundle(to, bundle, { allowCode: false });
    expect(report.codeSkipped).toBe(true);
    const site = (await ctx.website.designs.get(to, 'site', 'default')).data as Record<
      string,
      unknown
    >;
    expect(site.name).toBe('New');
    expect(site.headCode).toBe('<meta name="mine">');

    await themes.importBundle(to, bundle, { allowCode: true });
    const allowed = (await ctx.website.designs.get(to, 'site', 'default')).data as Record<
      string,
      unknown
    >;
    expect(allowed.headCode).toBe('<script>x</script>');
  });

  it('refuses a file that is not a valid bundle', async () => {
    const to = await freshSpace();
    await expect(
      themes.previewImport(to, { format: 'manablox-theme', version: 1 }),
    ).rejects.toMatchObject({
      key: 'plugins.website.theme.bundle.invalid',
    });
  });

  it('reports referenced assets the space does not have', async () => {
    const to = await freshSpace();
    const bundle: ThemeBundle = {
      format: 'manablox-theme',
      version: 1,
      designs: [],
      site: { ...defaultSiteSettings(), favicon: '0b7c2d3e-0000-4000-8000-000000000001' },
    };
    const report = await themes.previewImport(to, bundle);
    expect(report.missingAssets).toEqual(['0b7c2d3e-0000-4000-8000-000000000001']);
  });
});

describe('starter gallery', () => {
  it('lists built-in themes and the code themes that target the space', async () => {
    const targeted = await freshSpace();
    const other = await freshSpace('elsewhere');
    const gallery = await themes.starterThemes(targeted);
    const ids = gallery.map((entry) => entry.id);
    // Built-in themes are grouped; code themes have no category.
    expect(new Set(gallery.map((entry) => entry.category))).toEqual(
      new Set(['professional', 'creative', 'personal', null]),
    );
    expect(ids.at(0)).toBe('builtin:neutral');
    expect(ids.at(-1)).toBe('code:acme');
    expect(ids.filter((id) => id.startsWith('builtin:'))).toHaveLength(12);
    expect((await themes.starterThemes(other)).map((entry) => entry.id)).not.toContain('code:acme');
    await expect(themes.applyStarter(other, 'code:acme')).rejects.toMatchObject({
      key: 'plugins.website.theme.notFound',
    });
  });

  it('applies a starter as drafts and keeps stored designs unless replacing', async () => {
    const spaceId = await freshSpace();
    const first = await themes.applyStarter(spaceId, 'builtin:editorial');
    expect(first.entries.map((entry) => `${entry.kind}:${entry.key}:${entry.action}`)).toEqual([
      'theme:default:create',
      'menu:main:create',
      'menu:footer:create',
    ]);
    const kept = await themes.applyStarter(spaceId, 'builtin:bold');
    expect(kept.entries.every((entry) => entry.action === 'skip')).toBe(true);
    const replaced = await themes.applyStarter(spaceId, 'builtin:bold', { replace: true });
    expect(replaced.entries.every((entry) => entry.action === 'replace')).toBe(true);

    // A code theme maps its block designs by type name; code needs design:code.
    const code = await themes.applyStarter(spaceId, 'code:acme', { replace: true });
    expect(code.entries.find((entry) => entry.kind === 'block')).toMatchObject({
      key: ctx.ids.teaser,
      action: 'create',
    });
    expect(code.codeSkipped).toBe(true);
  });

  it('checks code themes and code block designs', async () => {
    expect(themeProblems([acme])).toEqual([]);
    const broken = defineTheme({
      id: 'broken',
      theme: { colors: 'nope' },
      designs: [{ kind: 'layout', key: 'x', data: { root: { id: 'r', el: 'box' } } }],
    });
    const problems = themeProblems([broken]);
    expect(problems.some((problem) => problem.startsWith('theme broken: theme.colors'))).toBe(true);
    expect(problems.some((problem) => problem.startsWith('theme broken: designs.0'))).toBe(true);
    expect(() => assertThemesValid([broken])).toThrow();
  });
});

describe('code block designs', () => {
  it('are the default of a block type until the space stores one', async () => {
    const spaceId = await freshSpace();
    const hero = ctx.ids.hero as string;
    const detail = await ctx.website.designs.get(spaceId, 'block', hero);
    expect(detail.status).toBe('generated');
    expect(detail.data).toEqual(heroDesign);

    const bundle = buildDesignBundle({
      space: { name: 'S', defaultLocale: 'en' },
      rows: [],
      variant: 'published',
      types: [
        ctx.manablox.contentTypes.get(hero),
        ctx.manablox.contentTypes.get(ctx.ids.teaser as string),
      ],
      menus: [],
    });
    expect(bundle.blocks[hero]).toEqual(heroDesign);
    expect(bundle.blocks[ctx.ids.teaser as string]).toEqual(
      generateBlockDesign(ctx.manablox.contentTypes.get(ctx.ids.teaser as string)),
    );
  });
});
