import { BLOCK_CLASS, GRID_CLASS } from '@manablox/public-sdk';
import {
  classFor,
  type DesignNode,
  ELEMENT_KINDS,
  elementClass,
  instanceClass,
  menuClass,
} from '@manablox/site';
import { describe, expect, it } from 'vitest';
import { contactType, heroAsset, heroType, pageDocument, quoteType } from './fixtures.js';
import { bareLayout, renderNodes } from './helpers.js';

const styled = { base: { gap: 'space:4' } } as const;

describe('structure elements', () => {
  it('renders boxes, stacks, grids, sections with their container, spacers and dividers', async () => {
    const { doc } = await renderNodes([
      { id: 'a', el: 'box', props: { as: 'article' }, style: styled, children: [] },
      { id: 'b', el: 'stack' },
      { id: 'c', el: 'grid', props: { as: 'script' } },
      {
        id: 'd',
        el: 'section',
        props: { container: 'wide' },
        children: [{ id: 'd1', el: 'text', props: { text: { en: 'Inside' } } }],
      },
      { id: 'e', el: 'spacer' },
      { id: 'f', el: 'divider' },
    ]);
    const box = doc.querySelector('article.mb-e-box');
    expect(box?.classList.contains(classFor('page', 't-page', 'a'))).toBe(true);
    expect(doc.querySelector('div.mb-e-stack')?.className).toBe('mb-e-stack');
    // Unknown tags fall back.
    expect(doc.querySelector('div.mb-e-grid')).not.toBeNull();
    const container = doc.querySelector(
      'section.mb-e-section > div.mb-container.mb-container-wide',
    );
    expect(container?.textContent).toBe('Inside');
    expect(doc.querySelector('.mb-e-spacer')?.getAttribute('aria-hidden')).toBe('true');
    expect(doc.querySelector('hr.mb-e-divider')).not.toBeNull();
  });

  it('adds the style class only to styled nodes and hide classes for breakpoints not shown', async () => {
    const { doc } = await renderNodes([
      { id: 'plain', el: 'box' },
      { id: 'mobile-only', el: 'box', visibility: { breakpoints: ['mobile'] } },
    ]);
    const classes = [...doc.querySelectorAll('.mb-e-box')].map((el) => el.className);
    expect(classes).toEqual(['mb-e-box', 'mb-e-box mb-hide-desktop mb-hide-tablet']);
  });
});

describe('content elements', () => {
  it('renders bound text with a fallback to static localized text', async () => {
    const { doc } = await renderNodes(
      [
        { id: 't1', el: 'text', bind: { field: 'f-intro' } },
        {
          id: 't2',
          el: 'text',
          bind: { field: 'f-missing' },
          props: { text: { en: 'Fallback', de: 'Ersatz' } },
        },
        { id: 't3', el: 'text', props: { as: 'small', text: { en: 'English', de: 'Deutsch' } } },
        { id: 'h', el: 'heading', props: { level: 3 }, bind: { field: '$title' } },
        { id: 'empty', el: 'text', bind: { field: 'f-missing' } },
      ],
      { locale: 'de' },
    );
    const texts = [...doc.querySelectorAll('.mb-e-text')].map((el) => el.textContent);
    expect(texts).toEqual(['Hello there', 'Ersatz', 'Deutsch']);
    expect(doc.querySelector('small.mb-e-text')).not.toBeNull();
    expect(doc.querySelector('h3.mb-e-heading')?.textContent).toBe('About us');
  });

  it('renders rich text sanitized, and plain strings as escaped paragraphs', async () => {
    const document = pageDocument();
    (document.fields as Record<string, unknown>).intro = 'Line <b>one</b>\n\nTwo';
    const { doc, html } = await renderNodes(
      [
        { id: 'r1', el: 'richtext', bind: { field: 'f-intro' } },
        {
          id: 'blocks',
          el: 'blocks',
          bind: { field: 'f-components' },
        },
      ],
      { document },
    );
    expect(doc.querySelector('.mb-e-richtext.mb-prose')?.innerHTML).toBe(
      '<p>Line &lt;b&gt;one&lt;/b&gt;</p><p>Two</p>',
    );
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('Body &lt;script&gt;');
  });

  it('renders images with srcset, sizes, dimensions and focal point', async () => {
    const { doc } = await renderNodes(
      [
        { id: 'img', el: 'image', props: { assetId: heroAsset.id, alt: { en: 'Custom alt' } } },
        { id: 'img2', el: 'image', props: { assetId: 'missing' } },
      ],
      {},
      { imageWidths: { card: 640, hero: 1920, thumb: 320 } },
    );
    const img = doc.querySelector('img.mb-e-image');
    expect(img?.getAttribute('src')).toBe(heroAsset.url);
    expect(img?.getAttribute('srcset')).toBe(
      'https://cdn.test/hero-card.webp 640w, https://cdn.test/hero-hero.webp 1920w, https://cdn.test/hero.jpg 2400w',
    );
    expect(img?.getAttribute('sizes')).toBe('100vw');
    expect(img?.getAttribute('alt')).toBe('Custom alt');
    expect(img?.getAttribute('width')).toBe('2400');
    expect(img?.getAttribute('loading')).toBe('lazy');
    expect(img?.getAttribute('style')).toBe('object-position:25% 75%');
    expect(doc.querySelectorAll('img').length).toBe(1);
  });

  it('loads images eagerly on the canvas, where lazy loading never fires', async () => {
    const { doc } = await renderNodes(
      [{ id: 'img', el: 'image', props: { assetId: heroAsset.id } }],
      { mode: 'canvas' },
    );
    expect(doc.querySelector('img.mb-e-image')?.getAttribute('loading')).toBe('eager');
  });

  it('renders video, icons, links and buttons', async () => {
    const video = {
      url: 'https://cdn.test/clip.mp4',
      mimeType: 'video/mp4',
      width: 640,
      height: 360,
    };
    const { doc } = await renderNodes(
      [
        { id: 'v', el: 'video', props: { assetId: 'clip', autoplay: true, loop: true } },
        { id: 'i', el: 'icon', props: { name: 'arrow-right' } },
        { id: 'i2', el: 'icon', props: { name: 'mail', label: { en: 'Email' } } },
        { id: 'i3', el: 'icon', props: { name: 'nope' } },
        {
          id: 'l',
          el: 'link',
          props: { href: '/contact', text: { en: 'Contact' }, target: '_blank' },
        },
        { id: 'l2', el: 'link', props: { href: 'javascript:alert(1)', text: { en: 'Bad' } } },
        {
          id: 'l3',
          el: 'link',
          props: { href: '/wrap' },
          children: [{ id: 'l3t', el: 'text', props: { as: 'span', text: { en: 'Wrapped' } } }],
        },
        {
          id: 'btn',
          el: 'button',
          props: { href: '/go', text: { en: 'Go' }, variant: 'secondary' },
        },
        { id: 'btn2', el: 'button', props: { text: { en: 'Nowhere' }, variant: 'nope' } },
      ],
      { assets: { clip: video } },
    );
    const clip = doc.querySelector('video.mb-e-video');
    expect(clip?.getAttribute('src')).toBe(video.url);
    expect(clip?.hasAttribute('autoplay')).toBe(true);
    expect(clip?.hasAttribute('muted')).toBe(true);
    expect(clip?.hasAttribute('controls')).toBe(true);
    const icons = doc.querySelectorAll('svg.mb-e-icon');
    expect(icons.length).toBe(2);
    expect(icons[0]?.getAttribute('aria-hidden')).toBe('true');
    expect(icons[1]?.getAttribute('aria-label')).toBe('Email');
    const links = doc.querySelectorAll('.mb-e-link');
    expect(links[0]?.getAttribute('href')).toBe('/contact');
    expect(links[0]?.getAttribute('rel')).toBe('noopener noreferrer');
    // An unsafe address is dropped; the text stays, not as a link.
    expect(links[1]?.tagName).toBe('SPAN');
    expect(links[2]?.querySelector('span.mb-e-text')?.textContent).toBe('Wrapped');
    const buttons = doc.querySelectorAll('.mb-e-button');
    expect(buttons[0]?.className).toBe('mb-e-button mb-button mb-button-secondary');
    expect(buttons[0]?.getAttribute('href')).toBe('/go');
    expect(buttons[1]?.className).toContain('mb-button-primary');
    expect(buttons[1]?.hasAttribute('href')).toBe(false);
  });

  it('frames only allow-listed embed providers', async () => {
    const { doc } = await renderNodes([
      {
        id: 'yt',
        el: 'embed',
        props: { url: 'https://youtu.be/dQw4w9WgXcQ?t=42', title: { en: 'Clip' } },
      },
      { id: 'vm', el: 'embed', props: { provider: 'vimeo', url: 'https://vimeo.com/76979871' } },
      { id: 'map', el: 'embed', props: { url: 'https://www.google.com/maps?q=Vienna' } },
      { id: 'bad', el: 'embed', props: { url: 'https://evil.test/embed?x=<script>' } },
      {
        id: 'mismatch',
        el: 'embed',
        props: { provider: 'vimeo', url: 'https://youtu.be/dQw4w9WgXcQ' },
      },
    ]);
    const frames = [...doc.querySelectorAll('iframe.mb-e-embed')];
    expect(frames.map((frame) => frame.getAttribute('src'))).toEqual([
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=42',
      'https://player.vimeo.com/video/76979871?dnt=1',
      'https://www.google.com/maps?q=Vienna&output=embed',
    ]);
    expect(frames[0]?.getAttribute('title')).toBe('Clip');
    expect(frames[0]?.getAttribute('sandbox')).toContain('allow-scripts');
    expect(frames[0]?.getAttribute('loading')).toBe('lazy');
  });
});

describe('bindings', () => {
  it('formats dates and numbers per locale and resolves document meta', async () => {
    const { doc } = await renderNodes(
      [
        { id: 'd', el: 'text', bind: { field: 'f-date', format: { type: 'date', style: 'long' } } },
        {
          id: 'n',
          el: 'text',
          bind: {
            field: 'f-price',
            format: { type: 'number', style: 'currency', currency: 'EUR' },
          },
        },
        {
          id: 'n2',
          el: 'text',
          bind: { field: 'f-price', format: { type: 'number', decimals: 0 } },
        },
        {
          id: 'p',
          el: 'text',
          bind: { field: '$publishedAt', format: { type: 'date', style: 'short', time: true } },
        },
        { id: 'a', el: 'text', bind: { field: '$author' } },
        { id: 's', el: 'text', bind: { field: '$permalink' } },
        { id: 'e', el: 'text', bind: { field: 'f-intro', format: { type: 'excerpt', length: 5 } } },
      ],
      { locale: 'de' },
    );
    const texts = [...doc.querySelectorAll('.mb-e-text')].map((el) => el.textContent);
    expect(texts[0]).toBe('5. Januar 2026');
    expect(texts[1]).toMatch(/^1\.234,50\s€$/);
    expect(texts[2]).toBe('1.235');
    expect(texts[3]).toBe('04.03.26, 10:00');
    expect(texts[4]).toBe('Ada');
    expect(texts[5]).toBe('/about');
    expect(texts[6]).toBe('Hello…');
  });

  it('hides a node when its whenField is empty', async () => {
    const { doc } = await renderNodes([
      {
        id: 'shown',
        el: 'text',
        props: { text: { en: 'A' } },
        visibility: { whenField: 'f-intro' },
      },
      {
        id: 'gone',
        el: 'text',
        props: { text: { en: 'B' } },
        visibility: { whenField: 'f-missing' },
      },
    ]);
    expect([...doc.querySelectorAll('.mb-e-text')].map((el) => el.textContent)).toEqual(['A']);
  });

  it('repeats children per repeater item with sub-field and $item bindings', async () => {
    const document = pageDocument();
    (document.fields as Record<string, unknown>).tags = ['red', 'blue'];
    const { doc } = await renderNodes(
      [
        {
          id: 'faq',
          el: 'repeat',
          bind: { field: 'f-faq' },
          children: [
            { id: 'q', el: 'heading', bind: { field: 'f-faq.q' } },
            { id: 'a', el: 'text', bind: { field: 'f-faq.a' } },
          ],
        },
        {
          id: 'limited',
          el: 'repeat',
          bind: { field: 'f-faq' },
          props: { limit: 1 },
          children: [{ id: 'q2', el: 'text', bind: { field: 'f-faq.q' } }],
        },
      ],
      { document },
    );
    const [faq, limited] = [...doc.querySelectorAll('.mb-e-repeat')];
    expect([...(faq?.querySelectorAll('h2') ?? [])].map((el) => el.textContent)).toEqual([
      'Why?',
      'How?',
    ]);
    expect([...(faq?.querySelectorAll('p') ?? [])].map((el) => el.textContent)).toEqual([
      'Because.',
      'Like this.',
    ]);
    expect(limited?.querySelectorAll('p').length).toBe(1);
  });

  it('resolves $site meta and falls back to the site settings', async () => {
    const { doc } = await renderNodes([{ id: 's', el: 'text', bind: { field: '$site.name' } }]);
    expect(doc.querySelector('.mb-e-text')?.textContent).toBe('Acme');
  });
});

describe('blocks', () => {
  it('lays blocks on the grid and renders each through its design, generated when missing', async () => {
    const { doc } = await renderNodes([
      { id: 'list', el: 'blocks', bind: { field: 'f-components' } },
    ]);
    const grid = doc.querySelector(`.${elementClass('blocks')}.${GRID_CLASS}`);
    expect(grid?.getAttribute('style')).toBe('--mb-cols: 2; --mb-cols-md: 2; --mb-cols-sm: 1');
    const blocks = grid?.querySelectorAll(`:scope > .${BLOCK_CLASS}`) ?? [];
    expect(blocks.length).toBe(2);
    expect(blocks[0]?.classList.contains(classFor('block', heroType.id, 'root'))).toBe(true);
    expect(blocks[0]?.getAttribute('style')).toBe('--mb-col: 1 / span 2; --mb-col-md: 1 / span 2');
    expect(blocks[0]?.querySelector('h2')?.textContent).toBe('Big news');
    expect(blocks[0]?.querySelector('a.mb-button')?.getAttribute('href')).toBe('https://x.test');
    expect(blocks[1]?.classList.contains(classFor('block', quoteType.id, 'root'))).toBe(true);
  });

  it('picks the instance variant, then the element variant, then the default; adds instance classes', async () => {
    const document = pageDocument();
    const style = { background: 'color:surface' as const, paddingY: 'space:8' as const };
    const components = document.fields.components as { blocks: Array<Record<string, unknown>> };
    (components.blocks[0] as Record<string, unknown>).design = { variant: 'wide', style };
    const blockDesigns = {
      [heroType.id]: {
        default: 'default',
        variants: {
          default: {
            label: 'Default',
            root: {
              id: 'root',
              el: 'box' as const,
              children: [{ id: 'h', el: 'heading' as const, bind: { field: 'f-headline' } }],
            },
          },
          wide: {
            label: 'Wide',
            root: {
              id: 'wide',
              el: 'section' as const,
              children: [
                {
                  id: 'h',
                  el: 'heading' as const,
                  props: { level: 1 },
                  bind: { field: 'f-headline' },
                },
              ],
            },
          },
        },
      },
      [quoteType.id]: {
        default: 'default',
        variants: {
          default: { label: 'Default', root: { id: 'root', el: 'box' as const } },
          compact: {
            label: 'Compact',
            root: {
              id: 'compact',
              el: 'box' as const,
              style: styled,
              children: [{ id: 't', el: 'text' as const, bind: { field: 'f-text' } }],
            },
          },
        },
      },
    };
    const { doc, instanceStyles } = await renderNodes(
      [
        {
          id: 'list',
          el: 'blocks',
          bind: { field: 'f-components' },
          props: { variant: 'compact' },
        },
      ],
      { document, blockDesigns },
    );
    const [hero, quote] = [...doc.querySelectorAll(`.${BLOCK_CLASS}`)];
    expect(hero?.tagName).toBe('SECTION');
    expect(hero?.querySelector('h1')?.textContent).toBe('Big news');
    expect(hero?.classList.contains(instanceClass(style) as string)).toBe(true);
    expect(quote?.classList.contains(classFor('block', quoteType.id, 'compact'))).toBe(true);
    expect(quote?.textContent).toBe('Quoted');
    expect(instanceStyles).toEqual([style]);
  });

  it('renders a single block field and template blocks', async () => {
    const document = pageDocument();
    const hero = (document.fields.components as { blocks: unknown[] }).blocks[0];
    Object.assign(document.fields, { featured: hero, tpl: { grid: null, blocks: [hero] } });
    const { doc } = await renderNodes(
      [
        { id: 'one', el: 'block', bind: { field: 'featured' } },
        { id: 'tpl', el: 'template', bind: { field: 'tpl' } },
      ],
      { document },
    );
    expect(doc.querySelector('.mb-e-block h2')?.textContent).toBe('Big news');
    expect(doc.querySelector('.mb-e-template h2')?.textContent).toBe('Big news');
  });
});

describe('forms', () => {
  const formNode: DesignNode = {
    id: 'form',
    el: 'form',
    props: { databagTypeId: contactType.id, consent: true, consentText: { en: 'I agree' } },
    children: [
      { id: 'name', el: 'formField', props: { fieldId: 'f-name', help: { en: 'Your full name' } } },
      { id: 'email', el: 'formField', props: { fieldId: 'f-email' } },
      {
        id: 'msg',
        el: 'formField',
        props: { fieldId: 'f-message', label: { en: 'Your message' } },
      },
      { id: 'topic', el: 'formField', props: { fieldId: 'f-topic' } },
      { id: 'news', el: 'formField', props: { fieldId: 'f-news' } },
      { id: 'send', el: 'formSubmit', props: { text: { en: 'Send it' } } },
      { id: 'msgbox', el: 'formMessage' },
    ],
  };

  it('renders a real form with honeypot, timestamp, labels, required inputs and consent', async () => {
    const { doc, islands } = await renderNodes([formNode]);
    const form = doc.querySelector('form.mb-e-form');
    expect(form?.getAttribute('method')).toBe('post');
    expect(form?.getAttribute('action')).toBe('/_manablox/forms/page/t-page/form');
    expect(form?.getAttribute('data-mb-island')).toBe('form');
    expect(form?.querySelector('input[name="_mb_ts"]')?.getAttribute('value')).toBe('1000');
    expect(form?.querySelector('input[name="_mb_page"]')?.getAttribute('value')).toBe('/about');
    const honeypot = form?.querySelector('.mb-hp input[name="_mb_hp"]');
    expect(honeypot?.getAttribute('tabindex')).toBe('-1');

    const name = form?.querySelector('input[name="name"]');
    expect(name?.hasAttribute('required')).toBe(true);
    expect(name?.className).toBe('mb-input');
    const label = form?.querySelector(`label[for="${name?.id}"]`);
    expect(label?.textContent).toBe('F-name');
    expect(name?.getAttribute('aria-describedby')).toBe(`${name?.id}-help`);
    expect(form?.querySelector('input[name="email"]')?.getAttribute('type')).toBe('email');
    expect(form?.querySelector('textarea[name="message"]')).not.toBeNull();
    const options = [...(form?.querySelectorAll('select[name="topic"] option') ?? [])].map(
      (o) => o.textContent,
    );
    expect(options).toEqual(['', 'Sales', 'help']);
    expect(form?.querySelector('input[name="newsletter"]')?.getAttribute('type')).toBe('checkbox');
    // Consent sits right before the submit button.
    const consent = form?.querySelector('input[name="_mb_consent"]');
    expect(consent?.hasAttribute('required')).toBe(true);
    expect(consent?.closest('.mb-form-consent')?.nextElementSibling?.tagName).toBe('BUTTON');
    const submit = form?.querySelector('button[type="submit"]');
    expect(submit?.textContent).toBe('Send it');
    expect(submit?.className).toContain('mb-button mb-button-primary');
    const message = form?.querySelector('[data-mb-form-message]');
    expect(message?.hasAttribute('hidden')).toBe(true);
    expect(message?.getAttribute('data-success')).toBe('Thank you!');
    expect(islands).toEqual(['form']);
  });

  it('shows the result of a redirected post', async () => {
    const { doc } = await renderNodes(
      [formNode],
      {},
      { formResult: { form: 'page:t-page:form', ok: true } },
    );
    const message = doc.querySelector('[data-mb-form-message]');
    expect(message?.hasAttribute('hidden')).toBe(false);
    expect(message?.textContent).toBe('Thank you!');
  });

  it('marks the fields a redirected post got wrong', async () => {
    const { doc } = await renderNodes(
      [formNode],
      {},
      {
        formResult: {
          form: 'page:t-page:form',
          ok: false,
          message: 'Please check the highlighted fields.',
          errors: { email: 'Not an email address', _mb_consent: 'Please agree to continue.' },
        },
      },
    );
    const email = doc.querySelector('input[name="email"]');
    expect(email?.getAttribute('aria-invalid')).toBe('true');
    const errorId = email?.getAttribute('aria-describedby') as string;
    expect(doc.getElementById(errorId)?.textContent).toBe('Not an email address');
    expect(doc.getElementById(errorId)?.className).toBe('mb-form-error');
    const name = doc.querySelector('input[name="name"]');
    expect(name?.hasAttribute('aria-invalid')).toBe(false);
    expect(name?.getAttribute('aria-describedby')).toBe(`${name?.id}-help`);
    expect(doc.querySelector('input[name="_mb_consent"]')?.getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(doc.querySelector('[data-mb-form-message]')?.textContent).toBe(
      'Please check the highlighted fields.',
    );
  });
});

describe('forms bound to a databag field', () => {
  const bound = (id: string, field = 'databag'): DesignNode => ({
    id,
    el: 'form',
    bind: { field },
    children: [
      { id: `${id}-input`, el: 'formField', props: { label: { en: 'Ignored' } } },
      { id: `${id}-send`, el: 'formSubmit' },
      { id: `${id}-msg`, el: 'formMessage' },
    ],
  });
  const withDatabag = (fields: Record<string, unknown>) => {
    const document = pageDocument();
    Object.assign(document.fields as Record<string, unknown>, fields);
    return { document };
  };

  it('repeats its input for every field of the picked type and signs the type', async () => {
    const { doc } = await renderNodes([bound('form')], withDatabag({ databag: contactType.id }), {
      formToken: (ref, typeId) => `${typeId}.signed-for-${ref}`,
    });
    const form = doc.querySelector('form.mb-e-form');
    const names = [...(form?.querySelectorAll('[name]') ?? [])]
      .map((el) => el.getAttribute('name'))
      .filter((name) => !name?.startsWith('_mb_'));
    expect(names).toEqual(['name', 'email', 'message', 'topic', 'newsletter']);
    const email = form?.querySelector('input[name="email"]');
    expect(email?.getAttribute('type')).toBe('email');
    expect(email?.hasAttribute('required')).toBe(true);
    expect(form?.querySelector(`label[for="${email?.id}"]`)?.textContent).toBe('F-email');
    expect(form?.querySelector('input[name="_mb_databag"]')?.getAttribute('value')).toBe(
      't-contact.signed-for-page:t-page:form',
    );
  });

  it('shows nothing live until a databag type is picked', async () => {
    const { doc } = await renderNodes([bound('form')], withDatabag({ databag: null }));
    expect(doc.querySelector('form')).toBeNull();
    const other = await renderNodes([bound('form')], withDatabag({ databag: 't-hero' }));
    expect(other.doc.querySelector('form')).toBeNull();
  });

  it('keeps results and ids apart per picked type', async () => {
    const { doc } = await renderNodes(
      [bound('form'), bound('form2', 'other')],
      withDatabag({ databag: contactType.id, other: contactType.id }),
      { formResult: { form: 'page:t-page:form@t-contact', ok: true } },
    );
    const forms = [...doc.querySelectorAll('form')];
    expect(forms).toHaveLength(2);
    expect(forms[0]?.id).not.toBe(forms[1]?.id);
    const messages = [...doc.querySelectorAll('[data-mb-form-message]')];
    expect(messages.map((el) => el.hasAttribute('hidden'))).toEqual([false, true]);
  });
});

describe('chrome elements', () => {
  it('renders menus with levels, current state and the mobile toggle', async () => {
    const layout = {
      key: 'default',
      design: {
        root: {
          id: 'root',
          el: 'stack' as const,
          children: [
            { id: 'nav', el: 'menu' as const, props: { menu: 'main' } },
            { id: 'slot', el: 'slot' as const },
          ],
        },
      },
    };
    const { doc, islands } = await renderNodes([], { layout });
    const nav = doc.querySelector('nav.mb-menu');
    expect(nav?.classList.contains(menuClass('main'))).toBe(true);
    expect(nav?.classList.contains('mb-e-menu')).toBe(true);
    expect(nav?.getAttribute('aria-label')).toBe('Main');
    const toggle = nav?.querySelector(':scope > button.mb-menu-toggle');
    const panel = nav?.querySelector(':scope > .mb-menu-panel');
    expect(toggle?.getAttribute('aria-controls')).toBe(panel?.id);
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    const top = panel?.querySelectorAll(
      'ul.mb-menu-list.mb-menu-l0 > li.mb-menu-item > a.mb-menu-link',
    );
    expect([...(top ?? [])].map((a) => a.getAttribute('aria-current'))).toEqual([null, 'true']);
    expect(panel?.querySelector('ul.mb-menu-l1 a')?.getAttribute('aria-current')).toBe('page');
    expect(islands).toEqual(['menu']);
    expect(doc.querySelector('main.mb-e-slot#main')).not.toBeNull();
  });

  it('renders logo, breadcrumbs, locale switch and search link', async () => {
    const layout = {
      key: 'default',
      design: {
        root: {
          id: 'root',
          el: 'stack' as const,
          children: [
            { id: 'logo', el: 'logo' as const },
            { id: 'crumbs', el: 'breadcrumbs' as const },
            { id: 'locales', el: 'localeSwitch' as const },
            { id: 'search', el: 'searchLink' as const, props: { href: '/search' } },
            { id: 'slot', el: 'slot' as const },
          ],
        },
      },
    };
    const site = {
      ...(await import('@manablox/site')).defaultSiteSettings(),
      name: 'Acme',
      logo: { assetId: heroAsset.id },
    };
    const { doc } = await renderNodes([], { layout, site });
    const logo = doc.querySelector('a.mb-e-logo');
    expect(logo?.getAttribute('href')).toBe('/');
    expect(logo?.querySelector('img')?.getAttribute('alt')).toBe('A hero');
    const crumbs = [...doc.querySelectorAll('.mb-e-breadcrumbs li')].map((li) => li.textContent);
    expect(crumbs).toEqual(['Acme', 'Company', 'About us']);
    expect(doc.querySelector('.mb-e-breadcrumbs [aria-current="page"]')?.textContent).toBe(
      'About us',
    );
    const locales = [...doc.querySelectorAll('.mb-e-locale-switch a')];
    expect(locales.map((a) => a.textContent)).toEqual(['English', 'Deutsch']);
    expect(locales[0]?.getAttribute('aria-current')).toBe('true');
    expect(locales[1]?.getAttribute('hreflang')).toBe('de');
    expect(doc.querySelector('a.mb-e-search-link')?.getAttribute('href')).toBe('/search');
  });

  it('covers every element kind', async () => {
    // Rendering each kind alone must not throw.
    for (const el of ELEMENT_KINDS) {
      await expect(renderNodes([{ id: 'x', el }], { layout: bareLayout })).resolves.toBeDefined();
    }
  });
});
