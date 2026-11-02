import type { ContentTypeDefinition } from '@manablox/core';
import { defaultTheme, instanceClass } from '@manablox/site';
import { describe, expect, it } from 'vitest';
import {
  canvasAssetIds,
  canvasLinkIds,
  instanceStylesOf,
  withCanvasLinks,
} from '../../src/admin/model/canvas-fields';
import { contentCanvasCss, contentCanvasInput } from '../../src/admin/model/site-canvas';
import { siteLink, toSiteMenu } from '../../src/admin/model/site-links';

const field = (id: string, name: string, type: string, settings: Record<string, unknown> = {}) => ({
  id,
  name,
  label: name,
  type,
  settings,
  required: false,
  localized: false,
  unique: false,
  admin: { zone: 'main', position: 0 },
});

const teaser = {
  id: 'teaser',
  name: 'teaser',
  label: 'Teaser',
  kind: 'block',
  fields: [field('t1', 'title', 'string'), field('t2', 'image', 'asset')],
} as unknown as ContentTypeDefinition;
const page = {
  id: 'page',
  name: 'page',
  label: 'Page',
  kind: 'content',
  fields: [field('p1', 'body', 'blocks'), field('p2', 'hero', 'asset')],
} as unknown as ContentTypeDefinition;
const types = [teaser, page];
const space = { id: 's1', name: 'Space', defaultLocale: 'en', locales: ['en'] };

const theme = defaultTheme();
const draftTheme = { ...theme, colors: { ...theme.colors, roles: { ...theme.colors.roles } } };

const source = (variant: 'published' | 'draft', rows = [] as never[]) =>
  contentCanvasInput({
    space,
    locale: 'en',
    types,
    pageTypeId: 'page',
    rows,
    variant,
    menus: {
      main: toSiteMenu({ id: 'm1', name: 'Main', machineName: 'main' }, [
        {
          id: 'i1',
          label: null,
          url: null,
          target: '_self',
          content: { title: 'Home', permalink: '/' },
          children: [],
        },
      ]),
    },
    assets: {},
  });

describe('content canvas input', () => {
  it('generates every design when nothing is stored', () => {
    const { input, designs } = source('published');
    expect(input.mode).toBe('canvas');
    expect(input.document).toBeNull();
    expect(input.page.key).toBe('page');
    expect(input.layout.key).toBe('default');
    expect(Object.keys(input.blockDesigns)).toEqual(['teaser']);
    expect(input.site.name).toBe('Space');
    expect(input.menuDesigns.main).toBeTruthy();
    expect(designs.map((design) => `${design.kind}:${design.key}`)).toEqual([
      'block:teaser',
      'page:page',
      'layout:default',
      'menu:main',
    ]);
  });

  it('uses the published copy, or the draft on request', () => {
    const block = (label: string) => ({
      default: 'default',
      variants: { default: { label, root: { id: 'root', el: 'box' } } },
    });
    const rows = [
      { kind: 'block', key: 'teaser', draft: block('Draft'), published: block('Live') },
      { kind: 'theme', key: 'default', draft: draftTheme, published: null },
    ] as never[];
    const live = source('published', rows).input;
    expect(live.blockDesigns.teaser?.variants.default?.label).toBe('Live');
    expect(live.theme).toEqual(theme);
    const drafts = source('draft', rows).input;
    expect(drafts.blockDesigns.teaser?.variants.default?.label).toBe('Draft');
    expect(drafts.theme).toBe(draftTheme);
  });

  it('resolves placed menus with their entries', () => {
    const { input } = source('published');
    const placed = Object.keys(input.menus);
    expect(placed.every((name) => name === 'main')).toBe(true);
    const menu = toSiteMenu(
      { id: 'm1', name: 'Main', machineName: 'main' },
      [
        {
          id: 'i1',
          label: '',
          url: null,
          target: '_self',
          content: { title: 'About', permalink: '/about' },
          children: [
            {
              id: 'i2',
              label: 'Docs',
              url: 'https://x.test',
              target: '_blank',
              content: null,
              children: [],
            },
          ],
        },
      ],
      '/about',
    );
    expect(menu.items[0]).toMatchObject({ label: 'About', url: '/about', current: true });
    expect(menu.items[0]?.children[0]).toMatchObject({ label: 'Docs', url: 'https://x.test' });
  });
});

describe('content canvas styles and assets', () => {
  const fields = {
    hero: 'a-hero',
    body: {
      blocks: [
        {
          blockId: 'b1',
          type: 'teaser',
          fields: { title: 'One', image: ['a-teaser'] },
          ext: {
            website: {
              style: { background: 'color:primary', backgroundImage: { assetId: 'a-bg' } },
            },
          },
        },
        { blockId: 'b2', type: 'teaser', fields: { title: 'Two' } },
      ],
    },
  };

  it('collects block overrides, nested ones included', () => {
    expect(instanceStylesOf(fields)).toEqual([
      { background: 'color:primary', backgroundImage: { assetId: 'a-bg' } },
    ]);
  });

  it('compiles the overrides into the stylesheet under their instance class', () => {
    const canvas = source('published');
    const styles = instanceStylesOf(fields);
    const css = contentCanvasCss(canvas, styles, {
      fontData: () => null,
      mediaOrigin: 'http://admin.test',
    });
    const name = instanceClass(styles[0]);
    expect(name).toBeTruthy();
    expect(css).toContain(`.${name}`);
    expect(css).toContain('http://admin.test/media/a-bg/original');
  });

  it('lists the assets of fields, blocks, overrides and designs', () => {
    const ids = canvasAssetIds(fields, page, (id) => types.find((type) => type.id === id) ?? null, [
      { favicon: 'a-icon', meta: { ogImage: 'a-og' } },
      { logo: { assetId: 'a-logo' } },
    ]);
    expect(ids).toEqual(['a-bg', 'a-hero', 'a-icon', 'a-logo', 'a-og', 'a-teaser']);
  });
});

describe('content canvas links', () => {
  const domains = [
    { hostname: 'example.test', locale: null, isPrimary: true },
    { hostname: 'beispiel.de', locale: 'de', isPrimary: true },
  ];

  it('links like the site: locale prefixes, or the locale domain', () => {
    const prefix = siteLink({ defaultLocale: 'en', localeStrategy: 'prefix', domains });
    expect(prefix('en', 'about/team')).toBe('/about/team');
    expect(prefix('de', 'ueber uns')).toBe('/de/ueber%20uns');
    expect(prefix('de', '')).toBe('/de');
    expect(prefix('en', '')).toBe('/');
    const domain = siteLink({ defaultLocale: 'en', localeStrategy: 'domain', domains });
    expect(domain('de', 'ueber')).toBe('https://beispiel.de/ueber');
    expect(domain('fr', 'a')).toBe('/fr/a');
  });

  it('links menu documents in the canvas locale, the home page at the root', () => {
    const link = siteLink({ defaultLocale: 'en', localeStrategy: 'prefix', domains });
    const menu = toSiteMenu(
      { id: 'm1', name: 'Main', machineName: 'main' },
      [
        {
          id: 'i1',
          label: '',
          url: null,
          target: '_self',
          content: { id: 'c1', title: 'Ueber', permalink: 'ueber' },
          children: [],
        },
        {
          id: 'i2',
          label: '',
          url: null,
          target: '_self',
          content: { id: 'home', title: 'Start', permalink: 'start' },
          children: [],
        },
      ],
      null,
      { locale: 'de', link, homeContentId: 'home' },
    );
    expect(menu.items.map((item) => item.url)).toEqual(['/de/ueber', '/de']);
  });

  it('inlines related documents and internal links of the draft, blocks included', () => {
    const card = {
      id: 'card',
      fields: [field('c1', 'more', 'link'), field('c2', 'related', 'content', { multiple: true })],
    } as unknown as ContentTypeDefinition;
    const doc = {
      id: 'doc',
      fields: [field('d1', 'body', 'blocks'), field('d2', 'parent', 'content')],
    } as unknown as ContentTypeDefinition;
    const typeById = (id: string) => (id === 'card' ? card : null);
    const fields = {
      parent: 'a',
      body: {
        blocks: [
          {
            blockId: 'b1',
            type: 'card',
            fields: { more: { mode: 'internal', contentId: 'b' }, related: ['a', 'gone'] },
          },
        ],
      },
    };
    expect(canvasLinkIds(fields, doc, typeById)).toEqual(['a', 'b', 'gone']);
    const targets = new Map([
      ['a', { id: 'a', title: 'A', permalink: 'a-page', locale: 'de' }],
      ['b', { id: 'b', title: 'B', permalink: null, locale: 'en' }],
    ]);
    const link = siteLink({ defaultLocale: 'en', localeStrategy: 'prefix', domains });
    const out = withCanvasLinks(fields, doc, typeById, targets, link);
    expect(out.parent).toEqual({ id: 'a', title: 'A', permalink: '/de/a-page', locale: 'de' });
    const block = (out.body as { blocks: Array<{ fields: Record<string, unknown> }> }).blocks[0];
    expect(block?.fields.more).toEqual({ mode: 'internal', contentId: 'b', href: null });
    expect(block?.fields.related).toEqual([
      { id: 'a', title: 'A', permalink: '/de/a-page', locale: 'de' },
    ]);
    // The draft itself is untouched.
    expect(fields.parent).toBe('a');
  });
});
