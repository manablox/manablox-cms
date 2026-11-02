import { describe, expect, it } from 'vitest';
import {
  type BlockDesign,
  type DesignNode,
  defaultSiteSettings,
  defaultTheme,
  generateLayout,
  MAX_DESIGN_DEPTH,
  starterThemes,
  validateInstanceStyle,
  validateSiteDesign,
} from '../src/index.js';

const block = (root: DesignNode): BlockDesign => ({
  variants: { default: { label: 'Default', root } },
  default: 'default',
});

function issuesOf(kind: Parameters<typeof validateSiteDesign>[0], data: unknown) {
  const result = validateSiteDesign(kind, data);
  return result.ok ? [] : result.issues;
}

function paths(kind: Parameters<typeof validateSiteDesign>[0], data: unknown) {
  return issuesOf(kind, data).map((issue) => issue.path);
}

describe('validateSiteDesign', () => {
  it('accepts the default theme, site settings and every starter theme with its menus', () => {
    expect(issuesOf('theme', defaultTheme())).toEqual([]);
    expect(issuesOf('site', defaultSiteSettings())).toEqual([]);
    for (const starter of starterThemes()) {
      expect(issuesOf('theme', starter.theme), starter.id).toEqual([]);
      for (const [key, menu] of Object.entries(starter.menus)) {
        expect(issuesOf('menu', menu), `${starter.id}/${key}`).toEqual([]);
      }
    }
  });

  it('rejects an unknown kind and non-objects', () => {
    expect(paths('nope' as never, {})).toEqual(['']);
    expect(paths('block', null)).toEqual(['']);
    expect(paths('block', [])).toEqual(['']);
  });

  it('requires unique node ids across all variants of a block', () => {
    const design: BlockDesign = {
      variants: {
        a: { label: 'A', root: { id: 'root', el: 'box', children: [{ id: 'x', el: 'text' }] } },
        b: { label: 'B', root: { id: 'root2', el: 'box', children: [{ id: 'x', el: 'text' }] } },
      },
      default: 'a',
    };
    const issues = issuesOf('block', design);
    expect(issues).toEqual([
      { path: 'variants.b.root.children.0.id', message: '"x" is used twice' },
    ]);
  });

  it('checks ids, the default variant and unknown keys', () => {
    expect(
      paths('block', {
        variants: { default: { label: 'D', root: { id: '1bad', el: 'box', color: 'red' } } },
        default: 'missing',
        extra: true,
      }),
    ).toEqual(['extra', 'variants.default.root.color', 'variants.default.root.id', 'default']);
  });

  it('rejects unknown elements and children on leaf elements', () => {
    expect(paths('block', block({ id: 'root', el: 'marquee' as never }))).toEqual([
      'variants.default.root.el',
    ]);
    expect(
      paths('block', block({ id: 'root', el: 'text', children: [{ id: 'a', el: 'text' }] })),
    ).toEqual(['variants.default.root.children']);
  });

  it('allows chrome elements only in layouts', () => {
    const tree: DesignNode = {
      id: 'root',
      el: 'box',
      children: [
        { id: 'slot', el: 'slot' },
        { id: 'nav', el: 'menu', props: { menu: 'main' } },
      ],
    };
    expect(issuesOf('page', { root: tree }).map((issue) => issue.message)).toEqual([
      'is only allowed in layouts',
      'is only allowed in layouts',
    ]);
    expect(issuesOf('layout', { root: tree })).toEqual([]);
  });

  it('requires exactly one slot in a layout', () => {
    expect(issuesOf('layout', { root: { id: 'root', el: 'box' } })).toEqual([
      { path: 'root', message: 'a layout needs exactly one slot element (found 0)' },
    ]);
    const two = {
      root: {
        id: 'root',
        el: 'box',
        children: [
          { id: 'a', el: 'slot' },
          { id: 'b', el: 'slot' },
        ],
      },
    };
    expect(paths('layout', two)).toEqual(['root']);
    expect(issuesOf('layout', generateLayout({ name: 'Site' }, [{ machineName: 'main' }]))).toEqual(
      [],
    );
  });

  it('checks the layout key and SEO fields of a page design', () => {
    const root: DesignNode = { id: 'root', el: 'box' };
    expect(
      issuesOf('page', { root, layout: 'blog', seo: { description: 'f-1', image: 'f2' } }),
    ).toEqual([]);
    expect(
      paths('page', { root, layout: 'bad key', seo: { description: '$title', image: 3, x: 1 } }),
    ).toEqual(['layout', 'seo.x', 'seo.description', 'seo.image']);
    expect(paths('page', { root, seo: 'f-1' })).toEqual(['seo']);
  });

  it('checks binding shapes and where meta bindings may be used', () => {
    const node = (field: unknown, extra: Record<string, unknown> = {}) =>
      ({ id: 'root', el: 'text', bind: { field, ...extra } }) as DesignNode;
    expect(issuesOf('block', block(node('title')))).toEqual([]);
    expect(paths('block', block(node('')))).toEqual(['variants.default.root.bind.field']);
    expect(paths('block', block(node(5)))).toEqual(['variants.default.root.bind.field']);
    expect(paths('block', block(node('$title')))).toEqual(['variants.default.root.bind.field']);
    expect(issuesOf('page', { root: node('$title') })).toEqual([]);
    expect(paths('page', { root: node('$site.name') })).toEqual(['root.bind.field']);
    expect(
      issuesOf('layout', {
        root: {
          id: 'root',
          el: 'box',
          children: [node('$site.name'), { id: 'slot', el: 'slot' }].map((entry, index) => ({
            ...entry,
            id: `n${index}`,
          })),
        },
      }),
    ).toEqual([]);
    expect(paths('block', block(node('a b')))).toEqual(['variants.default.root.bind.field']);
    expect(
      paths('block', block({ id: 'root', el: 'text', bind: { field: 'a', extra: 1 } as never })),
    ).toEqual(['variants.default.root.bind.extra']);
  });

  it('checks binding formats', () => {
    const withFormat = (format: unknown) =>
      block({ id: 'root', el: 'text', bind: { field: 'a', format } as never });
    expect(issuesOf('block', withFormat({ type: 'date', style: 'long', time: true }))).toEqual([]);
    expect(issuesOf('block', withFormat({ type: 'number', decimals: 2, currency: 'EUR' }))).toEqual(
      [],
    );
    expect(issuesOf('block', withFormat({ type: 'boolean', trueText: { en: 'Yes' } }))).toEqual([]);
    expect(paths('block', withFormat({ type: 'number', currency: 'euro' }))).toEqual([
      'variants.default.root.bind.format.currency',
    ]);
    expect(paths('block', withFormat({ type: 'weird' }))).toEqual([
      'variants.default.root.bind.format.type',
    ]);
  });

  it('only allows sub-field and $item paths inside a repeat bound to their parent', () => {
    const inRepeat = block({
      id: 'root',
      el: 'repeat',
      bind: { field: 'items' },
      children: [
        { id: 'a', el: 'text', bind: { field: 'items.title' } },
        { id: 'b', el: 'image', bind: { field: 'items.$item' } },
      ],
    });
    expect(issuesOf('block', inRepeat)).toEqual([]);
    expect(
      issuesOf('block', block({ id: 'root', el: 'text', bind: { field: 'items.title' } })),
    ).toEqual([
      {
        path: 'variants.default.root.bind.field',
        message: 'must be inside a repeat bound to items',
      },
    ]);
    expect(paths('block', block({ id: 'root', el: 'text', bind: { field: '$item.a' } }))).toEqual([
      'variants.default.root.bind.field',
    ]);
  });

  it('requires a binding on data elements', () => {
    expect(paths('block', block({ id: 'root', el: 'blocks' }))).toEqual([
      'variants.default.root.bind',
    ]);
    expect(paths('block', block({ id: 'root', el: 'repeat' }))).toEqual([
      'variants.default.root.bind',
    ]);
  });

  it('allows only allow-listed style props and token references', () => {
    const styled = (style: unknown) => block({ id: 'root', el: 'box', style } as DesignNode);
    expect(
      issuesOf(
        'block',
        styled({
          base: {
            padding: 'space:4',
            margin: 'auto',
            width: '50%',
            maxWidth: 'container:lg',
            color: 'color:primary/50',
            background: 'color:surface',
            backgroundGradient: { from: 'color:primary', to: 'color:accent', angle: 90 },
            radius: 'radius:md',
            shadow: 'shadow:lg',
            type: 'type:xl',
            font: 'font:heading',
            fontWeight: 700,
            columns: 3,
            opacity: 0.5,
          },
          hover: { color: 'color:accent' },
          mobile: { columns: 1 },
        }),
      ),
    ).toEqual([]);
    expect(
      paths(
        'block',
        styled({
          base: {
            padding: '12px',
            color: '#ff0000',
            radius: '4px',
            position: 'absolute',
            columns: 13,
            opacity: 2,
            width: 'calc(100% - 1px)',
          },
          print: {},
        }),
      ),
    ).toEqual([
      'variants.default.root.style.base.padding',
      'variants.default.root.style.base.color',
      'variants.default.root.style.base.radius',
      'variants.default.root.style.base.position',
      'variants.default.root.style.base.columns',
      'variants.default.root.style.base.opacity',
      'variants.default.root.style.base.width',
      'variants.default.root.style.print',
    ]);
  });

  it('checks the shape of localized static text', () => {
    const text = (value: unknown) => block({ id: 'root', el: 'text', props: { text: value } });
    expect(issuesOf('block', text({ en: 'Hi', 'de-AT': 'Servus' }))).toEqual([]);
    expect(paths('block', text('Hi'))).toEqual(['variants.default.root.props.text']);
    expect(paths('block', text({ en: 5 }))).toEqual(['variants.default.root.props.text.en']);
    expect(paths('block', text({ 'not a locale': 'x' }))).toEqual([
      'variants.default.root.props.text.not a locale',
    ]);
  });

  it('checks element props', () => {
    expect(
      paths(
        'block',
        block({
          id: 'root',
          el: 'box',
          children: [
            { id: 'h', el: 'heading', props: { level: 7 } },
            { id: 'l', el: 'link', props: { href: 'javascript:alert(1)' } },
            { id: 'b', el: 'button', props: { variant: 'huge' } },
            { id: 'e', el: 'embed', props: { provider: 'evil', url: 'http://x' } },
          ],
        }),
      ),
    ).toEqual([
      'variants.default.root.children.0.props.level',
      'variants.default.root.children.1.props.href',
      'variants.default.root.children.2.props.variant',
      'variants.default.root.children.3.props.provider',
      'variants.default.root.children.3.props.url',
    ]);
  });

  it('keeps form parts inside a form and forms out of forms and links', () => {
    expect(paths('block', block({ id: 'root', el: 'formSubmit' }))).toEqual([
      'variants.default.root.el',
    ]);
    const nested = block({
      id: 'root',
      el: 'form',
      props: { databagTypeId: 't' },
      children: [
        { id: 'inner', el: 'form', props: { databagTypeId: 't' } },
        { id: 'f1', el: 'formField', props: { fieldId: 'email' } },
        { id: 'f2', el: 'formField', props: { fieldId: 'email' } },
        { id: 'f3', el: 'formField' },
      ],
    });
    expect(issuesOf('block', nested)).toEqual([
      { path: 'variants.default.root.children.0.el', message: 'cannot be inside another form' },
      {
        path: 'variants.default.root.children.2.props.fieldId',
        message: 'is already used in this form',
      },
      { path: 'variants.default.root.children.3.props.fieldId', message: 'is required' },
    ]);
    expect(
      paths('block', block({ id: 'root', el: 'link', children: [{ id: 'b', el: 'button' }] })),
    ).toEqual(['variants.default.root.children.0.el', 'variants.default.root.children.0.el']);
  });

  it('lets a form bound to a field leave out its type and field ids', () => {
    const bound = block({
      id: 'root',
      el: 'form',
      bind: { field: 'databag' },
      children: [
        { id: 'input', el: 'formField' },
        { id: 'send', el: 'formSubmit' },
      ],
    });
    expect(issuesOf('block', bound)).toEqual([]);
    const mixed = block({
      id: 'root',
      el: 'form',
      bind: { field: 'databag' },
      props: { databagTypeId: 't' },
      children: [{ id: 'input', el: 'formField', props: { fieldId: 'email' } }],
    });
    expect(issuesOf('block', mixed)).toEqual([
      {
        path: 'variants.default.root.props.databagTypeId',
        message: 'must be left out when the form is bound to a field',
      },
      {
        path: 'variants.default.root.children.0.props.fieldId',
        message: 'must be left out in a form bound to a field',
      },
    ]);
  });

  it('limits nesting depth and size', () => {
    let node: DesignNode = { id: 'leaf', el: 'text' };
    for (let depth = 0; depth <= MAX_DESIGN_DEPTH; depth++) {
      node = { id: `n${depth}`, el: 'box', children: [node] };
    }
    expect(issuesOf('page', { root: node }).map((issue) => issue.message)).toEqual([
      `is nested deeper than ${MAX_DESIGN_DEPTH} levels`,
    ]);
    const big = block({
      id: 'root',
      el: 'text',
      props: { text: { en: 'x'.repeat(600 * 1024) } },
    });
    expect(issuesOf('block', big)[0]?.message).toMatch(/too large/);
  });

  it('checks visibility', () => {
    const visible = (visibility: unknown) =>
      block({ id: 'root', el: 'text', visibility } as DesignNode);
    expect(issuesOf('block', visible({ breakpoints: ['mobile'], whenField: 'a' }))).toEqual([]);
    expect(paths('block', visible({ breakpoints: ['mobile', 'mobile'] }))).toEqual([
      'variants.default.root.visibility.breakpoints',
    ]);
  });

  it('checks theme tokens and references', () => {
    const theme = defaultTheme();
    theme.colors.palette.bg = '#fff';
    theme.colors.roles.primary = 'nope';
    theme.colors.palette.bad = 'red; x: y';
    theme.fonts.roles.body = 'missing';
    theme.fonts.families.push({
      id: 'x',
      name: 'Evil"Font',
      source: 'asset',
      files: [{ weight: 400, style: 'normal' }],
      fallback: 'serif',
    });
    theme.space['4'] = '1';
    theme.shadow.md = 'url(x);';
    theme.container.default = 'huge';
    expect(paths('theme', theme)).toEqual([
      'colors.palette.bad',
      'colors.palette.bg',
      'colors.roles.primary',
      'fonts.families.2.name',
      'fonts.families.2.files.0.assetId',
      'fonts.roles.body',
      'space.4',
      'shadow.md',
      'container.default',
    ]);
  });

  it('checks menu designs', () => {
    expect(
      paths('menu', {
        preset: 'spiral',
        depth: 5,
        levels: [{ link: { base: { color: 'blue' } } }],
        mobile: { behaviour: 'none', breakpoint: 'desktop' },
      }),
    ).toEqual(['preset', 'depth', 'levels.0.link.base.color', 'mobile.breakpoint']);
  });

  it('checks site settings, custom CSS and code snippets', () => {
    const site = {
      ...defaultSiteSettings(),
      name: 'Site',
      customCss: '.a{color:red',
      headCode: 5,
      layouts: { 'type-1': 'bad key!' },
    };
    expect(paths('site', site)).toEqual(['customCss', 'headCode', 'layouts.type-1']);
    expect(
      issuesOf('site', {
        ...defaultSiteSettings(),
        customCss: '.a{content:"}"}',
        logo: { assetId: 'a1', alt: { en: 'Logo' } },
        meta: { description: { en: 'About' }, ogImage: 'a2' },
      }),
    ).toEqual([]);
  });
});

describe('validateInstanceStyle', () => {
  it('accepts the allow-list', () => {
    expect(
      validateInstanceStyle({
        background: 'color:surface',
        backgroundImage: { assetId: 'a1', size: 'cover' },
        paddingY: 'space:8',
        paddingX: '0',
        gap: 'space:4',
        textAlign: 'center',
        width: 'full',
        hide: ['mobile'],
      }),
    ).toMatchObject({ ok: true });
  });

  it('rejects anything else', () => {
    const result = validateInstanceStyle({
      background: '#fff',
      paddingY: '2rem',
      textAlign: 'justify',
      width: 'half',
      hide: ['watch'],
      color: 'color:text',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.path).sort()).toEqual(
        ['background', 'color', 'hide', 'paddingY', 'textAlign', 'width'].sort(),
      );
    }
    expect(validateInstanceStyle('x').ok).toBe(false);
  });
});
