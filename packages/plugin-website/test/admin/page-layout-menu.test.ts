import type { ContentTypeDefinition } from '@manablox/core';
import {
  type DesignNode,
  defaultSiteSettings,
  defaultTheme,
  generateLayout,
  generatePageDesign,
  type MenuDesign,
  type SiteMenu,
  validateSiteDesign,
} from '@manablox/site';
import { describe, expect, it } from 'vitest';
import {
  bindingLabel,
  bindingOptions,
  fieldAtPath,
  metaFields,
} from '../../src/admin/model/bindings';
import { paletteGroups } from '../../src/admin/model/elements';
import {
  bindForm,
  boundFieldOf,
  enclosingForm,
  type FormSourceType,
  fillable,
  formPaletteReasons,
  formWarnings,
  needsBoundInput,
  newForm,
  nextFormField,
  regenerateForm,
  toggleFormField,
  unfillableReason,
} from '../../src/admin/model/form-design';
import {
  layoutKeyFromName,
  layoutUsage,
  reassignPageLayout,
  reassignSiteLayouts,
  slotCount,
  slotDuplicateError,
  slotInsertError,
  slotRemovalError,
} from '../../src/admin/model/layout-design';
import {
  levelRules,
  menuDesignRows,
  presetDesign,
  withDepth,
  withLevelRules,
  withMobile,
  withPreset,
} from '../../src/admin/model/menu-design';
import { nodeLabel } from '../../src/admin/model/outline';
import {
  pageSampleDocument,
  pageSeoIssues,
  seoFieldOptions,
  withPageLayout,
  withSeo,
} from '../../src/admin/model/page-design';
import { designPreview, layoutKeyFor, sampleDocument } from '../../src/admin/model/site-preview';
import { designRoute } from '../../src/admin/model/status';

const field = (
  id: string,
  type: string,
  extra: Record<string, unknown> = {},
): {
  id: string;
  name: string;
  label: string;
  type: string;
  settings: Record<string, unknown>;
  required?: boolean;
  readRoles?: string[];
} => ({ id, name: id, label: id, type, settings: {}, ...extra });

describe('meta bindings', () => {
  it('offers document meta to pages and site meta to layouts, with labels', () => {
    expect(metaFields('page').map((entry) => entry.id)).toEqual([
      '$title',
      '$permalink',
      '$publishedAt',
      '$author',
    ]);
    expect(metaFields('layout').map((entry) => entry.id)).toContain('$site.logo');
    expect(metaFields('block')).toEqual([]);
    const fields = [...metaFields('layout'), field('intro', 'string')];
    expect(fieldAtPath(fields, '$site.name')?.field.label).toBe('Site name');
    expect(bindingLabel(fields, '$site.logo')).toBe('Site logo');
    expect(bindingLabel(fields, '$unknown')).toBe('$unknown');
    const images = bindingOptions(fields, 'image', []).map((option) => option.value);
    expect(images).toEqual(['$site.logo']);
    const texts = bindingOptions(fields, 'heading', []).map((option) => option.value);
    expect(texts).toContain('$title');
    expect(texts).toContain('intro');
  });
});

describe('palette', () => {
  it('adds form elements where the site takes posts and chrome only to layouts', () => {
    const labels = (kind: Parameters<typeof paletteGroups>[0]) =>
      paletteGroups(kind).map((group) => group.label);
    expect(labels('page')).toContain('Form');
    expect(labels('page')).not.toContain('Site');
    expect(labels('layout')).toEqual(expect.arrayContaining(['Form', 'Site']));
    expect(labels('menu')).not.toContain('Form');
  });

  it('routes every design kind to its designer', () => {
    expect(designRoute('page', 't1')).toBe('/design/pages/t1');
    expect(designRoute('layout')).toBe('/design/layouts');
    expect(designRoute('menu', 'main nav')).toBe('/design/menus/main%20nav');
    expect(designRoute('site')).toBe('/design/site');
  });
});

describe('layouts', () => {
  const layout = generateLayout({ name: 'Acme' }, [{ machineName: 'main' }]);

  it('makes keys from names, unique and in the server pattern', () => {
    expect(layoutKeyFromName('Landing Page!')).toBe('landing-page');
    expect(layoutKeyFromName('Über uns', ['uber-uns'])).toBe('uber-uns-2');
    expect(layoutKeyFromName('123')).toBe('layout');
    expect(layoutKeyFromName('')).toBe('layout');
  });

  it('keeps exactly one slot: no removing, copying or adding a second', () => {
    expect(slotCount(layout.root)).toBe(1);
    expect(slotRemovalError(layout.root, 'slot')).toMatch(/page content/);
    expect(slotRemovalError(layout.root, 'body')).toMatch(/page content/);
    expect(slotRemovalError(layout.root, 'header')).toBeNull();
    expect(slotDuplicateError(layout.root, 'body')).not.toBeNull();
    expect(slotDuplicateError(layout.root, 'footer')).toBeNull();
    expect(slotInsertError(layout.root)).not.toBeNull();
    expect(slotInsertError({ id: 'root', el: 'box' })).toBeNull();
  });

  it('knows which types use a layout and how', () => {
    const pages = {
      a: { root: { id: 'root', el: 'box' as const }, layout: 'blog' },
      b: null,
      c: { root: { id: 'root', el: 'box' as const }, layout: 'gone' },
    };
    const site = { layouts: { b: 'blog', d: 'blog' } };
    const existing = new Set(['default', 'blog']);
    expect(layoutUsage('blog', ['a', 'b', 'c', 'd', 'e'], pages, site, existing)).toEqual([
      { typeId: 'a', via: 'page' },
      { typeId: 'b', via: 'site' },
      { typeId: 'd', via: 'site' },
    ]);
    expect(layoutUsage('default', ['a', 'b', 'c', 'd', 'e'], pages, site, existing)).toEqual([
      { typeId: 'c', via: 'default' },
      { typeId: 'e', via: 'default' },
    ]);
  });

  it('moves page picks and site assignments to another layout', () => {
    const page = { root: { id: 'root', el: 'box' as const }, layout: 'blog' };
    expect(reassignPageLayout(page, 'blog', 'default')).toEqual({ root: page.root });
    expect(reassignPageLayout(page, 'blog', 'wide').layout).toBe('wide');
    expect(reassignPageLayout(page, 'other', 'wide')).toBe(page);
    const site = { ...defaultSiteSettings(), layouts: { a: 'blog', b: 'wide' } };
    expect(reassignSiteLayouts(site, 'blog', 'default').layouts).toEqual({ b: 'wide' });
    expect(reassignSiteLayouts(site, 'blog', 'wide').layouts).toEqual({ a: 'wide', b: 'wide' });
  });
});

describe('menu designs', () => {
  it('keeps the depth within what a preset shows', () => {
    const design = presetDesign('dropdown');
    expect(validateSiteDesign('menu', design)).toMatchObject({ ok: true });
    expect(withPreset({ ...design, depth: 3 }, 'bar').depth).toBe(1);
    expect(withDepth(withPreset(design, 'columns'), 5).depth).toBe(2);
    for (const preset of ['bar', 'list', 'dropdown', 'mega', 'columns'] as const)
      expect(validateSiteDesign('menu', presetDesign(preset))).toMatchObject({ ok: true });
  });

  it('edits level parts, the current page as plain props', () => {
    const base: MenuDesign = {
      preset: 'list',
      depth: 2,
      levels: [],
      mobile: { behaviour: 'none', breakpoint: 'mobile' },
    };
    const linked = withLevelRules(base, 1, 'link', {
      base: { color: 'color:primary' },
      hover: { color: 'color:text' },
    });
    expect(linked.levels).toHaveLength(2);
    expect(levelRules(linked, 1, 'link')?.hover).toEqual({ color: 'color:text' });
    const current = withLevelRules(linked, 0, 'current', { base: { fontWeight: 700 } });
    expect(current.levels[0]?.current).toEqual({ fontWeight: 700 });
    expect(levelRules(current, 0, 'current')).toEqual({ base: { fontWeight: 700 } });
    const cleared = withLevelRules(
      withLevelRules(current, 1, 'link', undefined),
      0,
      'current',
      undefined,
    );
    expect(cleared.levels).toEqual([]);
    expect(validateSiteDesign('menu', current)).toMatchObject({ ok: true });
  });

  it('patches the mobile settings and drops cleared keys', () => {
    const design = presetDesign('dropdown');
    const next = withMobile(design, { behaviour: 'offcanvas', label: undefined });
    expect(next.mobile.behaviour).toBe('offcanvas');
    expect('label' in next.mobile).toBe(false);
  });

  it('lists a design per menu plus stored shared designs', () => {
    const rows = menuDesignRows(
      [{ id: 'm1', name: 'Main', machineName: 'main' }],
      [
        { kind: 'menu', key: 'main', label: 'Main', status: 'changed', id: 'd1' },
        { kind: 'menu', key: 'dark', label: 'Dark', status: 'unpublished', id: 'd2' },
        { kind: 'layout', key: 'default', label: 'Default', status: 'generated', id: null },
      ],
    );
    expect(rows).toEqual([
      { key: 'main', label: 'Main', menuId: 'm1', status: 'changed', stored: true },
      { key: 'dark', label: 'Dark', menuId: null, status: 'unpublished', stored: true },
    ]);
  });
});

describe('page designs', () => {
  const fields = [
    field('intro', 'string'),
    field('code', 'string', { settings: { editor: 'code' } }),
    field('body', 'richtext'),
    field('cover', 'asset'),
    field('gallery', 'asset', { settings: { multiple: true } }),
  ];

  it('offers fitting fields for the description and the share image', () => {
    expect(seoFieldOptions(fields, 'description').map((entry) => entry.value)).toEqual([
      'intro',
      'body',
    ]);
    expect(seoFieldOptions(fields, 'image').map((entry) => entry.value)).toEqual(['cover']);
  });

  it('sets and clears SEO fields and the layout pick, and flags broken ones', () => {
    const page = { root: { id: 'root', el: 'box' as const } };
    const withBoth = withSeo(withSeo(page, 'description', 'intro'), 'image', 'gone');
    expect(withBoth.seo).toEqual({ description: 'intro', image: 'gone' });
    expect(pageSeoIssues(withBoth, fields)).toEqual([
      'The share image comes from a field the content type no longer has.',
    ]);
    expect(pageSeoIssues(withSeo(page, 'image', 'intro'), fields)).toHaveLength(1);
    expect(withSeo(withSeo(page, 'image', 'cover'), 'image', null)).toEqual(page);
    expect(withPageLayout(page, 'blog').layout).toBe('blog');
    expect(withPageLayout({ ...page, layout: 'blog' }, '')).toEqual(page);
    expect(validateSiteDesign('page', { ...withBoth, layout: 'blog' })).toMatchObject({ ok: true });
  });

  it('previews with a real document or generated values', () => {
    const generated = pageSampleDocument('t1', [...metaFields('page'), ...fields], null);
    expect(generated.title).toBe('Sample page');
    expect(Object.keys(generated.fields)).toEqual(['intro', 'code', 'body', 'cover', 'gallery']);
    const real = pageSampleDocument('t1', fields, {
      id: 'c1',
      localizationId: 'l1',
      typeId: 't1',
      title: 'Hello',
      permalink: '/hello',
      publishedAt: new Date('2026-01-02T03:04:05.000Z'),
      fields: { intro: 'Hi' },
    });
    expect(real).toMatchObject({
      title: 'Hello',
      publishedAt: '2026-01-02T03:04:05.000Z',
      fields: { intro: 'Hi' },
    });
  });
});

describe('forms', () => {
  const bag: FormSourceType = {
    id: 'bag',
    label: 'Contact',
    fields: [
      field('name', 'string', { required: true }),
      field('message', 'string', { settings: { editor: 'textarea' } }),
      field('secret', 'string', { readRoles: ['admin'] }),
      field('photo', 'asset'),
      field('code', 'string', { settings: { editor: 'code' }, required: true }),
    ],
  };

  it('accepts only fillable fields without roles', () => {
    expect(bag.fields.map((entry) => fillable(entry))).toEqual([true, true, false, false, false]);
    expect(unfillableReason(bag.fields[2] as FormSourceType['fields'][number])).toMatch(/roles/);
    expect(unfillableReason(bag.fields[3] as FormSourceType['fields'][number])).toMatch(/asset/);
    expect(unfillableReason(bag.fields[4] as FormSourceType['fields'][number])).toMatch(/code/);
  });

  it('builds a form with inputs for fillable fields only, ids clear of the design', () => {
    const form = newForm(bag, ['form', 'f-name'], 'en');
    expect(form.props?.databagTypeId).toBe('bag');
    const inputs = (form.children ?? []).filter((node) => node.el === 'formField');
    expect(inputs.map((node) => node.props?.fieldId)).toEqual(['name', 'message']);
    const ids = [form.id, ...(form.children ?? []).map((node) => node.id)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('form');
    expect(ids).not.toContain('f-name');
    const page = { root: { id: 'root', el: 'stack' as const, children: [form] } };
    expect(validateSiteDesign('page', page)).toMatchObject({ ok: true });
    expect(nodeLabel(inputs[0] as DesignNode)).toBe('name');
  });

  it('warns about required fields, ignored inputs, a missing button and disabled forms', () => {
    const form = newForm(bag, [], 'en');
    const kinds = (node: DesignNode, enabled?: boolean) =>
      formWarnings(node, bag, { formsEnabled: enabled }).map((warning) => warning.kind);
    expect(kinds(form, true)).toEqual(['requiredUnfillable']);
    const hidden = toggleFormField(
      form,
      bag.fields[0] as FormSourceType['fields'][number],
      false,
      [],
      'en',
    );
    expect(kinds(hidden)).toContain('requiredMissing');
    const withSecret: DesignNode = {
      ...form,
      children: [
        ...(form.children ?? []).filter((node) => node.el !== 'formSubmit'),
        { id: 'x', el: 'formField', props: { fieldId: 'secret' } },
        { id: 'y', el: 'formField', props: { fieldId: 'gone' } },
      ],
    };
    expect(kinds(withSecret, false)).toEqual([
      'requiredUnfillable',
      'unsupported',
      'unknownField',
      'noSubmit',
      'formsDisabled',
    ]);
    expect(formWarnings({ id: 'f', el: 'form' }, null).map((warning) => warning.kind)).toEqual([
      'noType',
      'noSubmit',
    ]);
  });

  it('shows and hides inputs before the submit button', () => {
    const form = regenerateForm(
      { id: 'form', el: 'form', props: { databagTypeId: 'bag' } },
      bag,
      [],
      'en',
    );
    const message = bag.fields[1] as FormSourceType['fields'][number];
    const without = toggleFormField(form, message, false, [], 'en');
    expect(nextFormField(without, [bag])?.id).toBe('message');
    const back = toggleFormField(without, message, true, ['form', 'f-name'], 'en');
    const order = (back.children ?? []).map((node) => node.el);
    expect(order.indexOf('formSubmit')).toBeGreaterThan(
      (back.children ?? []).findIndex((node) => node.props?.fieldId === 'message'),
    );
    expect(nextFormField(back, [bag])).toBeNull();
  });

  it('explains which form elements fit where the selection is', () => {
    const form = newForm(bag, [], 'en');
    const root: DesignNode = {
      id: 'root',
      el: 'stack',
      children: [{ id: 'text', el: 'text' }, form],
    };
    const outside = formPaletteReasons(root, 'text', [bag]);
    expect(outside.form).toBeUndefined();
    expect(outside.formField).toBeDefined();
    const inside = formPaletteReasons(root, form.children?.[0]?.id ?? null, [bag]);
    expect(inside.form).toBeDefined();
    expect(inside.formSubmit).toBeUndefined();
    // Every fillable field already has an input.
    expect(inside.formField).toBeDefined();
    expect(formPaletteReasons(root, 'text', []).form).toMatch(/databag type/);
    expect(enclosingForm(root, form.children?.[0]?.id ?? '')?.id).toBe(form.id);
  });

  it('binds a form to a databag field: one repeated input, no fixed type', () => {
    const fixed = newForm(bag, [], 'en');
    const bound = bindForm(fixed, 'picked', ['form', 'x']);
    expect(boundFieldOf(bound)).toBe('picked');
    expect(bound.props?.databagTypeId).toBeUndefined();
    expect(bound.props?.successMessage).toEqual(fixed.props?.successMessage);
    const kinds = (bound.children ?? []).map((node) => node.el);
    expect(kinds).toEqual(['formField', 'formSubmit', 'formMessage']);
    expect(bound.children?.[0]?.props).toBeUndefined();
    const block = {
      variants: {
        default: {
          label: 'Default',
          root: { id: 'root', el: 'stack' as const, children: [bound] },
        },
      },
      default: 'default',
    };
    expect(validateSiteDesign('block', block)).toMatchObject({ ok: true });

    const fields = [{ id: 'picked', type: 'databag' }];
    const warn = (node: DesignNode, list = fields) =>
      formWarnings(node, null, { fields: list }).map((warning) => warning.kind);
    expect(warn(bound)).toEqual([]);
    expect(warn(bound, [])).toEqual(['missingField']);
    const noInput = { ...bound, children: bound.children?.slice(1) ?? [] };
    expect(warn(noInput)).toEqual(['noInput']);
    expect(needsBoundInput(noInput)).toBe(true);

    const root: DesignNode = { id: 'root', el: 'stack', children: [bound] };
    const inside = formPaletteReasons(root, bound.children?.[0]?.id ?? null, [bag]);
    expect(inside.formField).toMatch(/every field/);
    const emptyRoot: DesignNode = { id: 'root', el: 'stack', children: [noInput] };
    expect(formPaletteReasons(emptyRoot, noInput.id, [bag]).formField).toBeUndefined();

    // Picking a fixed type again drops the binding.
    const again = regenerateForm(bound, bag, [], 'en');
    expect(boundFieldOf(again)).toBeNull();
    expect(again.props?.databagTypeId).toBe('bag');
  });
});

describe('designPreview', () => {
  const pageType = {
    id: 't-page',
    name: 'page',
    label: 'Page',
    kind: 'content',
    isSystem: false,
    fields: [],
  } as unknown as ContentTypeDefinition;
  const menus: Record<string, SiteMenu> = {
    main: { id: 'm1', name: 'Main', machineName: 'main', items: [] },
    footer: { id: 'm2', name: 'Footer', machineName: 'footer', items: [] },
  };
  const base = {
    space: { id: 's', name: 'Acme', defaultLocale: 'en', locales: ['en'] },
    locale: 'en',
    types: [pageType],
    menus,
    assets: {},
    theme: defaultTheme(),
    document: sampleDocument('t-page'),
  };

  it("renders the page in its layout pick, else the site's, else default", () => {
    const blog = generateLayout({ name: 'Blog' }, []);
    const rows = [
      { kind: 'layout', key: 'blog', draft: blog, published: null },
      {
        kind: 'site',
        key: 'default',
        draft: { ...defaultSiteSettings(), layouts: { 't-page': 'blog' } },
        published: null,
      },
    ];
    const page = generatePageDesign(pageType);
    const viaSite = designPreview({ ...base, rows, page: { key: 't-page', design: page } });
    expect(viaSite.input.layout.key).toBe('blog');
    const viaPage = designPreview({
      ...base,
      rows,
      page: { key: 't-page', design: { ...page, layout: 'missing' } },
    });
    expect(viaPage.input.layout.key).toBe('default');
    expect(layoutKeyFor({ ...page, layout: 'x' }, { layouts: { 't-page': 'y' } }, 't-page')).toBe(
      'x',
    );
  });

  it('shows the edited layout and menu design and the menus they place', () => {
    const layout = generateLayout({ name: 'Acme' }, [{ machineName: 'main' }]);
    const design = presetDesign('bar');
    const preview = designPreview({
      ...base,
      rows: [],
      page: { key: 'sample', design: { root: { id: 'root', el: 'box' } } },
      layout: { key: 'wide', design: layout },
      menuDesign: { key: 'main', design },
      extraMenu: 'footer',
    });
    expect(preview.input.layout).toEqual({ key: 'wide', design: layout });
    expect(Object.keys(preview.input.menus).sort()).toEqual(['footer', 'main']);
    expect(preview.input.menuDesigns.main).toBe(design);
    expect(preview.designs.map((entry) => `${entry.kind}:${entry.key}`)).toEqual(
      expect.arrayContaining(['page:sample', 'layout:wide', 'menu:main', 'menu:footer']),
    );
  });
});
