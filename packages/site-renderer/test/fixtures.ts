import type { ContentTypeDefinition, FieldDefinition } from '@manablox/core';
import {
  type DesignNode,
  defaultSiteSettings,
  defaultTheme,
  generateLayout,
  generatePageDesign,
  type SiteRenderInput,
} from '@manablox/site';

function field(
  id: string,
  type: string,
  settings: Record<string, unknown> = {},
  extra: Partial<FieldDefinition> = {},
): FieldDefinition {
  return {
    id,
    name: extra.name ?? id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    type,
    settings,
    required: false,
    localized: false,
    unique: false,
    admin: { zone: 'main', width: 100, position: 0 },
    ...extra,
  };
}

function contentType(
  id: string,
  name: string,
  kind: ContentTypeDefinition['kind'],
  fields: FieldDefinition[],
): ContentTypeDefinition {
  return {
    id,
    name,
    label: name,
    kind,
    spaceId: 'space-1',
    hasSlug: kind === 'content',
    isPublishable: kind !== 'block',
    isVisibleInTree: kind === 'content',
    canBeVisibleInMenu: kind === 'content',
    requiresApproval: false,
    fields: fields.map((entry, index) => ({
      ...entry,
      admin: { ...entry.admin, position: index },
    })),
    isSystem: false,
    source: 'runtime',
  };
}

/** A hero block: headline, rich body, image, call to action. */
export const heroType = contentType('t-hero', 'hero', 'block', [
  field('f-headline', 'string', {}, { name: 'headline' }),
  field('f-body', 'richtext', {}, { name: 'body' }),
  field('f-image', 'asset', { accept: ['image/*'] }, { name: 'image' }),
  field('f-cta', 'link', {}, { name: 'cta' }),
]);

export const quoteType = contentType('t-quote', 'quote', 'block', [
  field('f-text', 'string', { editor: 'textarea' }, { name: 'text' }),
]);

const pageType = contentType('t-page', 'page', 'content', [
  field('f-intro', 'string', {}, { name: 'intro' }),
  field('f-date', 'date', { mode: 'date' }, { name: 'date' }),
  field('f-price', 'number', {}, { name: 'price' }),
  field(
    'f-faq',
    'repeater',
    {
      fields: [
        { id: 'q', name: 'question', type: 'string' },
        { id: 'a', name: 'answer', type: 'string' },
      ],
    },
    { name: 'faq' },
  ),
  field('f-components', 'blocks', {}, { name: 'components' }),
]);

export const contactType = contentType('t-contact', 'contact', 'data', [
  field('f-name', 'string', {}, { name: 'name', required: true }),
  field('f-email', 'string', {}, { name: 'email', required: true }),
  field('f-message', 'string', { editor: 'textarea' }, { name: 'message' }),
  field(
    'f-topic',
    'select',
    { options: [{ value: 'sales', label: 'Sales' }, { value: 'help' }] },
    { name: 'topic' },
  ),
  field('f-news', 'boolean', {}, { name: 'newsletter' }),
]);

export const heroAsset = {
  id: 'asset-1',
  url: 'https://cdn.test/hero.jpg',
  filename: 'hero.jpg',
  mimeType: 'image/jpeg',
  size: 100,
  width: 2400,
  height: 1200,
  alt: 'A hero',
  title: null,
  variants: { card: 'https://cdn.test/hero-card.webp', hero: 'https://cdn.test/hero-hero.webp' },
  focalPoint: { x: 0.25, y: 0.75 },
};

export function pageDocument() {
  return {
    id: 'doc-1',
    localizationId: 'loc-1',
    typeId: 't-page',
    title: 'About us',
    permalink: '/about',
    publishedAt: '2026-03-04T10:00:00.000Z',
    author: 'Ada',
    fields: {
      intro: 'Hello there',
      date: '2026-01-05',
      price: 1234.5,
      faq: [
        { itemId: 'i1', fields: { question: 'Why?', answer: 'Because.' } },
        { itemId: 'i2', fields: { question: 'How?', answer: 'Like this.' } },
      ],
      components: {
        grid: { desktop: { columns: 2 }, tablet: { columns: 2 }, mobile: { columns: 1 } },
        blocks: [
          {
            blockId: 'b1',
            type: 'hero',
            fields: {
              headline: 'Big news',
              body: {
                type: 'doc',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Body <script>alert(1)</script>' }],
                  },
                ],
              },
              image: heroAsset,
              cta: {
                mode: 'external',
                url: 'https://x.test',
                href: 'https://x.test',
                target: '_blank',
                label: 'Go',
              },
            },
            layout: { column: 1, columnSpan: 2 },
          },
          { blockId: 'b2', type: 'quote', fields: { text: 'Quoted' } },
        ],
      },
    },
  };
}

const mainMenu = {
  id: 'm1',
  name: 'Main',
  machineName: 'main',
  items: [
    { id: 'a', label: 'Home', url: '/', target: '_self' as const, children: [] },
    {
      id: 'b',
      label: 'Company',
      url: '/company',
      target: '_self' as const,
      current: true,
      children: [
        {
          id: 'c',
          label: 'About',
          url: '/about',
          target: '_self' as const,
          current: true,
          children: [],
        },
      ],
    },
  ],
};

export function renderInput(overrides: Partial<SiteRenderInput> = {}): SiteRenderInput {
  const site = { ...defaultSiteSettings(), name: 'Acme' };
  return {
    mode: 'live',
    space: { id: 'space-1', name: 'Acme', defaultLocale: 'en', locales: ['en', 'de'] },
    locale: 'en',
    url: 'https://acme.test/about',
    alternates: [
      { locale: 'en', url: 'https://acme.test/about' },
      { locale: 'de', url: 'https://acme.test/de/ueber' },
    ],
    document: pageDocument(),
    status: 200,
    contentTypes: {
      [heroType.id]: heroType,
      [quoteType.id]: quoteType,
      [pageType.id]: pageType,
      [contactType.id]: contactType,
    },
    page: { key: 't-page', design: generatePageDesign(pageType) },
    layout: { key: 'default', design: generateLayout({ name: 'Acme' }, [{ machineName: 'main' }]) },
    blockDesigns: {},
    menuDesigns: {},
    menus: { main: mainMenu },
    theme: defaultTheme(),
    site,
    assets: { [heroAsset.id]: heroAsset },
    cssHref: '/_site/abc.css',
    formActionBase: '/_manablox/forms',
    ...overrides,
  };
}

/** A page design whose root holds `children`. */
export function pageWith(...children: DesignNode[]) {
  return { key: 't-page', design: { root: { id: 'root', el: 'stack' as const, children } } };
}
