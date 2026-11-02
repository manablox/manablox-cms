import { classFor, defaultSiteSettings, generateLayout } from '@manablox/site';
import { describe, expect, it } from 'vitest';
import { renderSitePage } from '../src/page.js';
import { heroAsset, heroType, pageWith, renderInput } from './fixtures.js';
import { bareLayout, parse, renderNodes } from './helpers.js';

const site = {
  ...defaultSiteSettings(),
  name: 'Acme',
  titlePattern: '{title} - {site}',
  favicon: 'fav',
  meta: { description: { en: 'We make things', de: 'Wir machen Dinge' }, ogImage: heroAsset.id },
  headCode: '<meta name="custom-head" content="1">',
  bodyEndCode: '<script>window.custom = 1</script>',
};
const favicon = { url: '/media/fav.png', mimeType: 'image/png' };
const coverAsset = { url: 'https://cdn.test/cover.jpg', width: 1200, height: 630 };

describe('renderSitePage', () => {
  it('writes the head: title, description, canonical, alternates, OG, favicon, fonts, CSS, head code', async () => {
    const { html, head, status } = await renderSitePage(
      renderInput({ site, assets: { [heroAsset.id]: heroAsset, fav: favicon } }),
    );
    const doc = parse(html);
    expect(status).toBe(200);
    expect(doc.documentElement.getAttribute('lang')).toBe('en');
    expect(doc.title).toBe('About us - Acme');
    expect(head).toEqual({
      title: 'About us - Acme',
      description: 'We make things',
      image: heroAsset.url,
    });
    const meta = (selector: string) => doc.querySelector(selector)?.getAttribute('content');
    expect(meta('meta[name="description"]')).toBe('We make things');
    expect(doc.querySelector('meta[name="robots"]')).toBeNull();
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      'https://acme.test/about',
    );
    const alternates = [...doc.querySelectorAll('link[rel="alternate"]')].map((link) => [
      link.getAttribute('hreflang'),
      link.getAttribute('href'),
    ]);
    expect(alternates).toEqual([
      ['en', 'https://acme.test/about'],
      ['de', 'https://acme.test/de/ueber'],
      ['x-default', 'https://acme.test/about'],
    ]);
    expect(meta('meta[property="og:title"]')).toBe('About us');
    expect(meta('meta[property="og:image"]')).toBe(heroAsset.url);
    expect(meta('meta[property="og:site_name"]')).toBe('Acme');
    expect(meta('meta[name="twitter:card"]')).toBe('summary_large_image');
    expect(doc.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe('/media/fav.png');
    expect(doc.querySelector('link[rel="preload"][as="font"]')?.getAttribute('href')).toBe(
      '/_site/fonts/inter/Inter-Variable.woff2',
    );
    expect(doc.querySelector('link[rel="stylesheet"]')?.getAttribute('href')).toBe(
      '/_site/abc.css',
    );
    expect(doc.querySelector('head meta[name="custom-head"]')).not.toBeNull();
    expect(html).toContain('<script>window.custom = 1</script>');
  });

  it("takes the description and share image from the page design's fields", async () => {
    const base = renderInput({ site, assets: { [heroAsset.id]: heroAsset, cover: coverAsset } });
    const document = base.document ? { ...base.document } : null;
    if (!document) throw new Error('no document');
    document.fields = { ...document.fields, cover: 'cover', intro: `${'word '.repeat(60)}end` };
    const pageType = base.contentTypes['t-page'];
    if (!pageType) throw new Error('no page type');
    const withCover = {
      ...pageType,
      fields: [
        ...pageType.fields,
        { ...pageType.fields[0], id: 'f-cover', name: 'cover', type: 'asset' },
      ],
    } as typeof pageType;
    const { html, head } = await renderSitePage({
      ...base,
      document,
      contentTypes: { ...base.contentTypes, 't-page': withCover },
      page: {
        ...base.page,
        design: { ...base.page.design, seo: { description: 'f-intro', image: 'f-cover' } },
      },
    });
    expect(head.description.length).toBeLessThanOrEqual(161);
    expect(head.description.startsWith('word word')).toBe(true);
    expect(head.image).toBe(coverAsset.url);
    const doc = parse(html);
    expect(doc.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe(
      coverAsset.url,
    );
    // Empty fields fall back to the site's defaults.
    document.fields = { ...document.fields, cover: null, intro: '' };
    const fallback = await renderSitePage({
      ...base,
      document,
      contentTypes: { ...base.contentTypes, 't-page': withCover },
      page: {
        ...base.page,
        design: { ...base.page.design, seo: { description: 'f-intro', image: 'f-cover' } },
      },
    });
    expect(fallback.head).toMatchObject({ description: 'We make things', image: heroAsset.url });
  });

  it('marks share pages noindex with a preview badge, and leaves out canonical links', async () => {
    const { html } = await renderSitePage(renderInput({ mode: 'share', site }));
    const doc = parse(html);
    expect(doc.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'noindex, nofollow',
    );
    expect(doc.querySelector('.mb-preview-badge')?.textContent).toBe('Preview');
    expect(doc.querySelector('link[rel="canonical"]')).toBeNull();
    // Head code still runs on share pages.
    expect(doc.querySelector('meta[name="custom-head"]')).not.toBeNull();
  });

  it('adds the site badge when given, escaped and with its own styles', async () => {
    const plain = await renderSitePage(renderInput({ site }));
    expect(parse(plain.html).querySelector('.mb-site-badge')).toBeNull();

    const badge = {
      text: 'Made with <b>Manablox</b> & "co"',
      link: 'https://manablox.io/?a=1&b="2"',
    };
    const { html } = await renderSitePage(renderInput({ site }), { badge });
    expect(html).not.toContain('<b>Manablox</b>');
    const link = parse(html).querySelector('a.mb-site-badge');
    expect(link?.textContent).toBe(badge.text);
    expect(link?.getAttribute('href')).toBe(badge.link);
    expect(link?.getAttribute('rel')).toBe('noopener');
    expect(link?.getAttribute('style')).toMatch(/^all:initial;/);

    // Never on the canvas, and not with an unsafe link.
    const canvas = await renderSitePage(renderInput({ mode: 'canvas', site }), { badge });
    expect(canvas.html).not.toContain('mb-site-badge');
    const unsafe = await renderSitePage(renderInput({ site }), {
      badge: { text: 'x', link: 'javascript:alert(1)' },
    });
    expect(unsafe.html).not.toContain('mb-site-badge');
  });

  it('adds noindex when the site is not indexed', async () => {
    const { html } = await renderSitePage(
      renderInput({ site: { ...site, robots: { index: false } } }),
    );
    expect(parse(html).querySelector('meta[name="robots"]')).not.toBeNull();
  });

  it('loads island scripts only for elements that need them', async () => {
    const plain = await renderNodes([{ id: 't', el: 'text', props: { text: { en: 'x' } } }]);
    expect(plain.html).not.toContain('<script');
    const withMenu = await renderSitePage(renderInput(), {
      islandSrc: { menu: '/_site/islands/menu.abc.js' },
    });
    expect(withMenu.islands).toEqual(['menu']);
    expect(withMenu.html).toContain(
      '<script type="module" src="/_site/islands/menu.abc.js"></script>',
    );
  });

  it('renders the not-found page without a document', async () => {
    const { html, status } = await renderSitePage(renderInput({ document: null, status: 404 }));
    const doc = parse(html);
    expect(status).toBe(404);
    expect(doc.title).toBe('Page not found | Acme');
    expect(doc.querySelector('h1')?.textContent).toBe('Page not found');
  });

  it('renders the default layout around the page', async () => {
    const { html } = await renderSitePage(renderInput());
    const doc = parse(html);
    expect(doc.querySelector('main#main h1')?.textContent).toBe('About us');
    expect(doc.querySelector('.mb-e-logo')?.textContent).toBe('Acme');
    expect(doc.querySelectorAll('nav.mb-menu').length).toBe(1);
  });
});

describe('canvas mode', () => {
  it('marks nodes and bound fields, and leaves out scripts and head code', async () => {
    const { html, islands } = await renderSitePage(
      renderInput({
        mode: 'canvas',
        site,
        page: pageWith(
          { id: 'intro', el: 'text', bind: { field: 'f-intro' } },
          { id: 'title', el: 'heading', bind: { field: '$title' } },
          { id: 'list', el: 'blocks', bind: { field: 'f-components' } },
          { id: 'empty', el: 'text' },
        ),
        layout: {
          key: 'default',
          design: generateLayout({ name: 'Acme' }, [{ machineName: 'main' }]),
        },
      }),
    );
    const doc = parse(html);
    expect(islands).toEqual([]);
    expect(html).not.toContain('<script');
    expect(doc.querySelector('meta[name="custom-head"]')).toBeNull();
    const intro = doc.querySelector('[data-mb-node="page:t-page:intro"]');
    expect(intro?.getAttribute('data-mb-el')).toBe('text');
    expect(intro?.getAttribute('data-manablox-field')).toBe('intro');
    expect(
      doc.querySelector('[data-mb-node="page:t-page:title"]')?.getAttribute('data-manablox-field'),
    ).toBe('title');
    expect(doc.querySelector('[data-mb-node="layout:default:header"]')).not.toBeNull();
    const list = doc.querySelector('[data-manablox-list="components"]');
    expect(list?.getAttribute('data-mb-node')).toBe('page:t-page:list');
    const hero = list?.querySelector('[data-manablox-field="components.0"]');
    expect(hero?.getAttribute('data-mb-node')).toBe(`block:${heroType.id}:root`);
    expect(hero?.getAttribute('data-mb-block')).toBe(heroType.id);
    expect(hero?.querySelector('[data-manablox-field="components.0.headline"]')?.textContent).toBe(
      'Big news',
    );
    // Empty elements stay selectable.
    expect(
      doc.querySelector('[data-mb-node="page:t-page:empty"]')?.getAttribute('data-mb-empty'),
    ).toBe('Text');
  });

  it('marks only the focused design and drops content markers in design mode', async () => {
    const { html } = await renderSitePage(
      renderInput({
        mode: 'canvas',
        page: pageWith({ id: 'intro', el: 'text', bind: { field: 'f-intro' } }),
      }),
      { focus: { kind: 'page', key: 't-page' } },
    );
    const doc = parse(html);
    expect(doc.querySelector('[data-mb-node="page:t-page:intro"]')).not.toBeNull();
    expect(doc.querySelector('[data-mb-node^="layout:"]')).toBeNull();
    expect(doc.querySelector('[data-manablox-field]')).toBeNull();
  });

  it('renders a block design alone with sample values', async () => {
    const { html } = await renderSitePage(
      renderInput({
        mode: 'canvas',
        layout: bareLayout,
        document: { ...renderInput().document!, fields: { headline: 'Sample headline' } },
      }),
      { focus: { kind: 'block', key: heroType.id } },
    );
    const doc = parse(html);
    expect(doc.querySelector(`[data-mb-node="block:${heroType.id}:root"] h2`)?.textContent).toBe(
      'Sample headline',
    );
  });

  it('renders a menu design in the layout band that places it', async () => {
    const { html } = await renderSitePage(
      renderInput({
        mode: 'canvas',
        layout: {
          key: 'default',
          design: {
            root: {
              id: 'root',
              el: 'stack',
              children: [
                {
                  id: 'header',
                  el: 'section',
                  props: { as: 'header' },
                  style: { base: { background: 'color:text', color: 'color:bg' } },
                  children: [
                    { id: 'logo', el: 'logo' },
                    { id: 'nav', el: 'menu', props: { menu: 'main' } },
                  ],
                },
                { id: 'slot', el: 'slot' },
                { id: 'footer', el: 'section', props: { as: 'footer' } },
              ],
            },
          },
        },
      }),
      { focus: { kind: 'menu', key: 'main' } },
    );
    const doc = parse(html);
    // The header's background and logo come along; the page and footer do not.
    const header = doc.querySelector('header');
    expect(header?.className).toContain(classFor('layout', 'default', 'header'));
    expect(header?.querySelector('[data-mb-node="menu:main:root"]')).not.toBeNull();
    expect(doc.querySelector('footer')).toBeNull();
    expect(doc.querySelector('[data-mb-node^="layout:"]')).toBeNull();
  });

  it('renders a menu design alone when no layout places it', async () => {
    const { html } = await renderSitePage(renderInput({ mode: 'canvas', layout: bareLayout }), {
      focus: { kind: 'menu', key: 'main' },
    });
    const doc = parse(html);
    expect(doc.querySelector('section [data-mb-node="menu:main:root"]')).not.toBeNull();
  });

  it('renders the theme style guide', async () => {
    const { html } = await renderSitePage(renderInput({ mode: 'canvas' }), {
      focus: { kind: 'theme', key: 'default' },
    });
    const doc = parse(html);
    expect(doc.querySelectorAll('.mb-style-guide .mb-button').length).toBe(3);
    expect(doc.querySelector('.mb-style-guide h1')?.textContent).toBe('Heading 1');
  });
});
