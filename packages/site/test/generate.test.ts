import { describe, expect, it } from 'vitest';
import {
  BLOCK_PRESETS,
  type DesignNode,
  findBrokenBindings,
  findUnplacedFields,
  generateBlockDesign,
  generateBlockPreset,
  generateFormNodes,
  generateLayout,
  generateMenuDesign,
  generatePageDesign,
  isFormField,
  validateSiteDesign,
  walkNodes,
} from '../src/index.js';
import { field, typeWith } from './fixtures.js';

function nodes(root: DesignNode): DesignNode[] {
  const out: DesignNode[] = [];
  walkNodes(root, ({ node }) => {
    out.push(node);
  });
  return out;
}

function byBinding(root: DesignNode, path: string): DesignNode | undefined {
  return nodes(root).find((node) => node.bind?.field === path);
}

/** What the first field of each built-in type becomes. */
const EXPECTED: Record<string, { el: string; format?: string }> = {
  string: { el: 'heading' },
  richtext: { el: 'richtext' },
  number: { el: 'text', format: 'number' },
  boolean: { el: 'text', format: 'boolean' },
  date: { el: 'text', format: 'date' },
  select: { el: 'text' },
  link: { el: 'button' },
  asset: { el: 'image' },
  content: { el: 'link' },
  user: { el: 'text' },
  block: { el: 'block' },
  blocks: { el: 'blocks' },
  repeater: { el: 'repeat' },
  template: { el: 'template' },
  databag: { el: 'form' },
};

const SETTINGS: Record<string, Record<string, unknown>> = {
  select: { options: [{ value: 'a' }] },
  repeater: {
    fields: [
      { id: 'sub-title', name: 'title', type: 'string' },
      { name: 'photo', type: 'asset' },
    ],
  },
};

describe('generateBlockDesign', () => {
  // `@manablox/fields` checks that this covers every built-in field type.
  it('maps every built-in field type', () => {
    const names = Object.keys(EXPECTED);
    const type = typeWith(names.map((name) => field(`f_${name}`, name, SETTINGS[name] ?? {})));
    const design = generateBlockDesign(type);
    const root = design.variants.default?.root as DesignNode;
    for (const name of names) {
      const node = byBinding(root, `f_${name}`);
      expect(node?.el, name).toBe(EXPECTED[name]?.el);
      expect(node?.bind?.format?.type, name).toBe(EXPECTED[name]?.format);
    }
    expect(validateSiteDesign('block', design)).toMatchObject({ ok: true });
    expect(findUnplacedFields(design, type)).toEqual([]);
    expect(findBrokenBindings(design, type)).toEqual([]);
  });

  it('makes the first string a heading and the rest text, the first link a button', () => {
    const design = generateBlockDesign(
      typeWith([
        field('title', 'string'),
        field('subtitle', 'string'),
        field('body', 'string', { editor: 'textarea' }),
        field('cta', 'link'),
        field('more', 'link'),
      ]),
    );
    const root = design.variants.default?.root as DesignNode;
    expect(root.children?.map((node) => [node.el, node.bind?.field])).toEqual([
      ['heading', 'title'],
      ['text', 'subtitle'],
      ['text', 'body'],
      ['button', 'cta'],
      ['link', 'more'],
    ]);
    expect(root.children?.[0]?.props).toEqual({ level: 2 });
  });

  it('orders by zone and position', () => {
    const type = {
      fields: [
        field('side', 'string', {}, { admin: { zone: 'sidebar', width: 100, position: 0 } }),
        field('second', 'string', {}, { admin: { zone: 'main', width: 100, position: 2 } }),
        field('first', 'string', {}, { admin: { zone: 'main', width: 100, position: 1 } }),
      ],
    };
    const root = generateBlockDesign(type).variants.default?.root as DesignNode;
    expect(root.children?.map((node) => node.bind?.field)).toEqual(['first', 'second', 'side']);
  });

  it('formats dates, multi selects and code', () => {
    const root = generateBlockDesign(
      typeWith([
        field('day', 'date', { mode: 'date' }),
        field('at', 'date'),
        field('tags', 'select', { options: [{ value: 'a' }], multiple: true }),
        field('snippet', 'string', { editor: 'code' }),
      ]),
    ).variants.default?.root as DesignNode;
    expect(byBinding(root, 'day')?.bind?.format).toEqual({ type: 'date', style: 'long' });
    expect(byBinding(root, 'at')?.bind?.format).toEqual({
      type: 'date',
      style: 'long',
      time: true,
    });
    expect(byBinding(root, 'tags')?.bind?.format).toEqual({ type: 'list' });
    expect(byBinding(root, 'snippet')).toMatchObject({ el: 'text', props: { as: 'pre' } });
  });

  it('repeats list fields and picks the element by accepted mime types', () => {
    const type = typeWith([
      field('gallery', 'asset', { multiple: true, accept: ['image/'] }),
      field('clip', 'asset', { accept: ['video/'] }),
      field('file', 'asset', { accept: ['application/pdf'] }),
      field('related', 'content', { multiple: true }),
      field('authors', 'user', { multiple: true }),
    ]);
    const design = generateBlockDesign(type);
    const root = design.variants.default?.root as DesignNode;
    const gallery = byBinding(root, 'gallery');
    expect(gallery?.el).toBe('repeat');
    expect(gallery?.style?.base).toMatchObject({ display: 'grid', columns: 3 });
    expect(gallery?.children?.[0]).toMatchObject({ el: 'image', bind: { field: 'gallery.$item' } });
    expect(byBinding(root, 'clip')?.el).toBe('video');
    expect(byBinding(root, 'file')?.el).toBe('link');
    expect(byBinding(root, 'related.$item')?.el).toBe('link');
    expect(byBinding(root, 'authors.$item')?.el).toBe('text');
    expect(validateSiteDesign('block', design)).toMatchObject({ ok: true });
    expect(findBrokenBindings(design, type)).toEqual([]);
  });

  it('generates repeater children bound relative to the item, nested repeaters too', () => {
    const type = typeWith([
      field('faq', 'repeater', {
        fields: [
          { id: 'q', name: 'question', type: 'string' },
          { id: 'a', name: 'answer', type: 'richtext' },
          {
            id: 'links',
            name: 'links',
            type: 'repeater',
            settings: { fields: [{ name: 'url', type: 'link' }] },
          },
        ],
      }),
    ]);
    const design = generateBlockDesign(type);
    const root = design.variants.default?.root as DesignNode;
    expect(byBinding(root, 'faq.q')).toMatchObject({ el: 'heading', props: { level: 3 } });
    expect(byBinding(root, 'faq.a')?.el).toBe('richtext');
    expect(byBinding(root, 'faq.links')?.el).toBe('repeat');
    expect(byBinding(root, 'faq.links.url')?.el).toBe('link');
    expect(validateSiteDesign('block', design)).toMatchObject({ ok: true });
    expect(findBrokenBindings(design, type)).toEqual([]);
  });

  it('gives unique, deterministic node ids', () => {
    const type = typeWith([
      field('x1', 'string', {}, { name: 'a b' }),
      field('x2', 'string', {}, { name: 'a-b' }),
      field('x3', 'string', {}, { name: '123' }),
    ]);
    const first = generateBlockDesign(type);
    expect(generateBlockDesign(type)).toEqual(first);
    const ids = nodes(first.variants.default?.root as DesignNode).map((node) => node.id);
    expect(ids).toEqual(['root', 'f-a-b', 'f-a-b-2', expect.stringMatching(/^f[0-9a-f]{8}$/)]);
    expect(validateSiteDesign('block', first)).toMatchObject({ ok: true });
  });

  it('shows unknown plugin types as text', () => {
    const root = generateBlockDesign(typeWith([field('color', 'colorPicker')])).variants.default
      ?.root as DesignNode;
    expect(byBinding(root, 'color')?.el).toBe('text');
  });
});

describe('generatePageDesign', () => {
  it('puts the title first as h1 and every field below it', () => {
    const type = typeWith([field('intro', 'string'), field('body', 'blocks')]);
    const design = generatePageDesign(type);
    const content = nodes(design.root).find((node) => node.id === 'content') as DesignNode;
    expect(content.children?.map((node) => [node.el, node.bind?.field])).toEqual([
      ['heading', '$title'],
      ['text', 'intro'],
      ['blocks', 'body'],
    ]);
    expect(validateSiteDesign('page', design)).toMatchObject({ ok: true });
    expect(findUnplacedFields(design, type)).toEqual([]);
  });
});

describe('generateLayout', () => {
  it('places logo, main menu, the slot and the footer menu', () => {
    const layout = generateLayout({ name: 'Acme', defaultLocale: 'de' }, [
      { machineName: 'footer' },
      { machineName: 'main' },
    ]);
    const all = nodes(layout.root);
    expect(all.filter((node) => node.el === 'slot')).toHaveLength(1);
    expect(all.find((node) => node.id === 'main-menu')?.props).toEqual({ menu: 'main' });
    expect(all.find((node) => node.id === 'footer-menu')?.props).toEqual({ menu: 'footer' });
    expect(all.find((node) => node.id === 'site-name')).toMatchObject({
      bind: { field: '$site.name' },
      props: { text: { de: 'Acme' } },
    });
    expect(validateSiteDesign('layout', layout)).toMatchObject({ ok: true });
  });

  it('works without menus and falls back to the first non-footer menu', () => {
    expect(nodes(generateLayout({ name: 'A' }).root).some((node) => node.el === 'menu')).toBe(
      false,
    );
    const layout = generateLayout({ name: 'A' }, [
      { machineName: 'footer-links' },
      { machineName: 'top' },
    ]);
    const all = nodes(layout.root);
    expect(all.find((node) => node.id === 'main-menu')?.props).toEqual({ menu: 'top' });
    expect(all.find((node) => node.id === 'footer-menu')?.props).toEqual({ menu: 'footer-links' });
  });
});

describe('generateMenuDesign', () => {
  it('uses footer columns for footer menus and a dropdown otherwise', () => {
    expect(generateMenuDesign({ machineName: 'footer' }).preset).toBe('columns');
    expect(generateMenuDesign({ machineName: 'main' }).preset).toBe('dropdown');
    expect(validateSiteDesign('menu', generateMenuDesign({ machineName: 'x' }))).toMatchObject({
      ok: true,
    });
  });
});

describe('generateFormNodes', () => {
  it('builds one input per supported field, a submit button and a message', () => {
    const type = typeWith(
      [
        field('name', 'string'),
        field('email', 'string'),
        field('message', 'string', { editor: 'textarea' }),
        field('age', 'number'),
        field('newsletter', 'boolean'),
        field('topic', 'select', { options: [{ value: 'a' }] }),
        field('day', 'date', { mode: 'date' }),
        field('photo', 'asset'),
        field('snippet', 'string', { editor: 'code' }),
      ],
      'bag-1',
    );
    const form = generateFormNodes(type, { taken: ['form'] });
    expect(form).toMatchObject({ el: 'form', props: { databagTypeId: 'bag-1' } });
    expect(form.id).toBe('form-2');
    expect(form.children?.map((node) => [node.el, node.props?.fieldId, node.props?.input])).toEqual(
      [
        ['formField', 'name', 'text'],
        ['formField', 'email', 'email'],
        ['formField', 'message', 'textarea'],
        ['formField', 'age', 'number'],
        ['formField', 'newsletter', 'checkbox'],
        ['formField', 'topic', 'select'],
        ['formField', 'day', 'date'],
        ['formSubmit', undefined, undefined],
        ['formMessage', undefined, undefined],
      ],
    );
    expect(isFormField(field('photo', 'asset'))).toBe(false);
    const page = { root: { id: 'root', el: 'box' as const, children: [form] } };
    expect(validateSiteDesign('page', page)).toMatchObject({ ok: true });
  });

  it('gives every node an id of its own, clear of taken ones', () => {
    const type = typeWith(
      [
        field('message', 'string'),
        field('form-message', 'string'),
        field('submit', 'string'),
        field('form-2-submit', 'string'),
      ],
      'bag-1',
    );
    const taken = ['form', 'f-message', 'form-2-message'];
    const form = generateFormNodes(type, { taken });
    const ids = [form.id, ...(form.children ?? []).map((node) => node.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(taken).not.toContain(id);
    const page = { root: { id: 'form', el: 'box' as const, children: [form] } };
    expect(validateSiteDesign('page', page)).toMatchObject({ ok: true });
  });
});

describe('findUnplacedFields / findBrokenBindings', () => {
  it('report new fields and removed ones', () => {
    const before = typeWith([field('title', 'string'), field('body', 'richtext')]);
    const design = generateBlockDesign(before);
    const after = typeWith([field('title', 'string'), field('image', 'asset')]);
    expect(findUnplacedFields(design, after).map((entry) => entry.id)).toEqual(['image']);
    expect(findBrokenBindings(design, after)).toEqual([{ nodeId: 'f-body', field: 'body' }]);
  });

  it('check repeater sub-fields and whenField conditions', () => {
    const type = typeWith([
      field('items', 'repeater', { fields: [{ id: 'a', name: 'a', type: 'string' }] }),
    ]);
    const design = generatePageDesign(type);
    design.root.children?.push({
      id: 'gone',
      el: 'repeat',
      bind: { field: 'items' },
      visibility: { whenField: 'removed' },
      children: [{ id: 'sub', el: 'text', bind: { field: 'items.b' } }],
    });
    expect(findBrokenBindings(design, type)).toEqual([
      { nodeId: 'gone', field: 'removed' },
      { nodeId: 'sub', field: 'items.b' },
    ]);
  });
});

describe('generateBlockPreset', () => {
  const type = typeWith([
    field('title', 'string'),
    field('photo', 'asset', { accept: ['image/*'] }),
    field('body', 'richtext'),
    field('cta', 'link'),
  ]);

  it.each(BLOCK_PRESETS)('lays out %s as a valid variant that shows every field', (preset) => {
    const generated = generateBlockDesign(type);
    const variant = generateBlockPreset(type, preset, {
      taken: nodes(generated.variants.default!.root).map((node) => node.id),
    });
    const design = { ...generated, variants: { ...generated.variants, [preset]: variant } };
    expect(validateSiteDesign('block', design).ok).toBe(true);
    expect(findUnplacedFields({ variants: { x: variant }, default: 'x' }, type)).toEqual([]);
  });

  it('puts media beside the content for image left and keeps ids free', () => {
    const variant = generateBlockPreset(type, 'imageLeft', { taken: ['root', 'f-photo'] });
    expect(variant.root.id).toBe('root-2');
    const [media, content] = variant.root.children ?? [];
    expect(media?.children?.[0]).toMatchObject({ el: 'image', id: 'f-photo-2' });
    expect(content?.children?.map((node) => node.el)).toEqual(['heading', 'richtext', 'button']);
  });

  it('leaves the media column out when the type has no media', () => {
    const variant = generateBlockPreset(typeWith([field('title', 'string')]), 'imageLeft');
    expect(variant.root.children?.map((node) => node.id)).toEqual(['content']);
  });
});
