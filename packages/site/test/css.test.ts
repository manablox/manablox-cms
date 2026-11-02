import { BLOCK_GRID_CSS } from '@manablox/public-sdk';
import { describe, expect, it } from 'vitest';
import {
  type BlockDesign,
  classFor,
  compileSiteCss,
  defaultTheme,
  elementClass,
  type InstanceStyle,
  instanceClass,
  menuClass,
  starterThemes,
  type ThemeDesign,
} from '../src/index.js';

const design: BlockDesign = {
  variants: {
    default: {
      label: 'Default',
      root: {
        id: 'root',
        el: 'stack',
        style: {
          base: { gap: 'space:4', padding: 'space:6', background: 'color:surface' },
          tablet: { padding: 'space:4' },
          mobile: { padding: 'space:2', direction: 'column' },
          hover: { shadow: 'shadow:md' },
          focus: { borderColor: 'color:primary' },
          active: { opacity: 0.8 },
        },
        children: [
          {
            id: 'title',
            el: 'heading',
            style: { base: { type: 'type:2xl', color: 'color:primary/50' } },
          },
          { id: 'plain', el: 'text' },
        ],
      },
    },
  },
  default: 'default',
};

const blockClass = classFor('block', 'type-1', 'root');

describe('class names', () => {
  it('are stable, CSS-safe and differ per design key', () => {
    expect(classFor('block', 'type-1', 'root')).toBe(blockClass);
    expect(blockClass).toMatch(/^mb-block-[0-9a-f]{8}-root$/);
    expect(classFor('block', 'type-2', 'root')).not.toBe(blockClass);
    expect(classFor('page', 'type-1', 'root')).not.toBe(blockClass);
    expect(elementClass('formField')).toBe('mb-e-form-field');
    expect(elementClass('box')).toBe('mb-e-box');
  });

  it('gives equal instance overrides the same class regardless of key order', () => {
    const a = instanceClass({
      paddingY: 'space:8',
      background: 'color:surface',
      hide: ['tablet', 'mobile'],
    });
    const b = instanceClass({
      background: 'color:surface',
      hide: ['mobile', 'tablet'],
      paddingY: 'space:8',
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^mb-i-[0-9a-f]{8}$/);
    expect(instanceClass({})).toBeNull();
    expect(instanceClass(null)).toBeNull();
    expect(instanceClass({ hide: [] })).toBeNull();
  });
});

describe('compileSiteCss', () => {
  const css = compileSiteCss({
    theme: defaultTheme(),
    designs: [{ kind: 'block', key: 'type-1', data: design }],
  });

  it('declares the layers first and wraps the rules in them in order', () => {
    expect(css.startsWith('@layer mb-reset,mb-theme,mb-design,mb-instance,mb-custom;')).toBe(true);
    const order = ['@layer mb-reset{', '@layer mb-theme{', '@layer mb-design{'].map((entry) =>
      css.indexOf(entry),
    );
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(css).not.toContain('@layer mb-instance{');
    expect(css).not.toContain('@layer mb-custom{');
  });

  it('emits tokens as custom properties', () => {
    expect(css).toContain('--mb-color-blue600:#2563eb');
    expect(css).toContain('--mb-color-primary:var(--mb-color-blue600)');
    expect(css).toContain('--mb-space-4:1rem');
    expect(css).toContain('--mb-radius-md:0.5rem');
    expect(css).toContain('--mb-type-base-size:1rem');
    expect(css).toContain('--mb-type-base-letter-spacing:normal');
    expect(css).toContain('--mb-font-inter:"Inter", system-ui');
    expect(css).toContain('--mb-font-body:var(--mb-font-inter)');
    expect(css).toContain('--mb-container-default:var(--mb-container-lg)');
    expect(css).toContain('--mb-container-gutter:var(--mb-space-4)');
  });

  it('emits the dark scheme for the system preference and the forcing attribute', () => {
    expect(css).toContain(
      '@media (prefers-color-scheme:dark){:root:not([data-mb-scheme=light]){--mb-color-bg:var(--mb-color-gray900)',
    );
    expect(css).toMatch(/:root\[data-mb-scheme=dark\]\{--mb-color-bg:var\(--mb-color-gray900\)/);
    const theme = defaultTheme();
    delete theme.colors.dark;
    const light = compileSiteCss({ theme });
    expect(light).not.toContain('prefers-color-scheme');
  });

  it('emits font faces with the bundled default URL or a resolver', () => {
    expect(css).toContain(
      '@font-face{font-family:"Inter";src:url("/_site/fonts/inter/Inter-Variable.woff2") format("woff2");font-weight:100 900;font-style:normal;font-display:swap}',
    );
    const theme = defaultTheme();
    theme.fonts.families.push({
      id: 'brand',
      name: 'Brand Sans',
      source: 'asset',
      files: [{ assetId: 'asset-1', weight: 700, style: 'italic' }],
      fallback: 'sans-serif',
    });
    const withAssets = compileSiteCss({
      theme,
      fontUrl: (file) => (file.assetId ? `/media/${file.assetId}.woff2` : null),
    });
    expect(withAssets).toContain(
      '@font-face{font-family:"Brand Sans";src:url("/media/asset-1.woff2") format("woff2");font-weight:700;font-style:italic;font-display:swap}',
    );
    expect(withAssets).not.toContain('Inter-Variable');
    expect(compileSiteCss({ theme })).not.toContain('Brand Sans";src');
  });

  it('includes the block grid CSS so grids and designs share breakpoints', () => {
    expect(css).toContain(BLOCK_GRID_CSS);
    expect(css).toContain('@media (max-width:1023px)');
    expect(css).toContain('@media (max-width:639px)');
  });

  it('emits a class per styled node with states and breakpoints', () => {
    const c = `.${blockClass}`;
    expect(css).toContain(
      `${c}{padding:var(--mb-space-6);gap:var(--mb-space-4);background-color:var(--mb-color-surface)}`,
    );
    expect(css).toContain(`${c}:hover{box-shadow:var(--mb-shadow-md)}`);
    expect(css).toContain(`${c}:focus-visible{border-color:var(--mb-color-primary)}`);
    expect(css).toContain(`${c}:active{opacity:0.8}`);
    expect(css).toContain(`@media (max-width:1023px){${c}{padding:var(--mb-space-4)}}`);
    expect(css).toContain(
      `@media (max-width:639px){${c}{padding:var(--mb-space-2);flex-direction:column}}`,
    );
    const title = `.${classFor('block', 'type-1', 'title')}`;
    expect(css).toContain(
      `${title}{font-size:var(--mb-type-2xl-size);line-height:var(--mb-type-2xl-line-height);font-weight:var(--mb-type-2xl-weight);letter-spacing:var(--mb-type-2xl-letter-spacing);color:color-mix(in srgb, var(--mb-color-primary) 50%, transparent)}`,
    );
    expect(css).not.toContain(classFor('block', 'type-1', 'plain'));
  });

  it('emits mobile type sizes, heading defaults and base element styles', () => {
    expect(css).toMatch(/@media \(max-width:639px\)\{:root\{--mb-type-2xl-size:/);
    expect(css).toContain(
      'h1{font-family:var(--mb-font-heading);font-size:var(--mb-type-4xl-size)',
    );
    expect(css).toContain(
      '.mb-button-primary{color:var(--mb-color-onPrimary);background-color:var(--mb-color-primary)',
    );
    expect(css).toContain(
      '.mb-button-primary:hover{background-color:color-mix(in srgb, var(--mb-color-primary) 85%, transparent)}',
    );
    expect(css).toContain('.mb-input:focus-visible{border-color:var(--mb-color-primary)}');
    expect(css).toContain('.mb-prose>*+*{margin-top:');
    expect(css).toContain('.mb-container-lg{max-width:var(--mb-container-lg)}');
    expect(css).toContain('@media (max-width:639px){.mb-hide-mobile{display:none!important}}');
  });

  it('keeps the link style off buttons rendered as links', () => {
    expect(css).toContain('a:where(:not(.mb-button)){text-decoration-line:underline;');
    expect(css).not.toMatch(/(^|[}\n])a\{/);
  });

  it('is deterministic whatever order designs come in', () => {
    const other: BlockDesign = {
      variants: {
        default: {
          label: 'D',
          root: { id: 'root', el: 'box', style: { base: { gap: 'space:2' } } },
        },
      },
      default: 'default',
    };
    const page = { root: { id: 'root', el: 'box', style: { base: { padding: 'space:8' } } } };
    const a = compileSiteCss({
      theme: defaultTheme(),
      designs: [
        { kind: 'block', key: 'b', data: other },
        { kind: 'page', key: 'p', data: page },
        { kind: 'block', key: 'a', data: design },
      ],
    });
    const b = compileSiteCss({
      theme: defaultTheme(),
      designs: [
        { kind: 'block', key: 'a', data: design },
        { kind: 'block', key: 'b', data: other },
        { kind: 'page', key: 'p', data: page },
      ],
    });
    expect(a).toBe(b);
    expect(a.indexOf(classFor('page', 'p', 'root'))).toBeLessThan(
      a.indexOf(classFor('block', 'a', 'root')),
    );
  });

  it('compiles instance overrides into their own layer, one rule per combination', () => {
    const style: InstanceStyle = {
      background: 'color:accent',
      paddingY: 'space:12',
      width: 'full',
      hide: ['mobile'],
    };
    const out = compileSiteCss({
      theme: defaultTheme(),
      instanceStyles: [style, { ...style }, null, { textAlign: 'center' }],
    });
    const name = instanceClass(style) as string;
    expect(out).toContain(
      `.${name}{padding-block:var(--mb-space-12);background-color:var(--mb-color-accent);width:100%;max-width:none}`,
    );
    expect(out).toContain(`@media (max-width:639px){.${name}{display:none}}`);
    expect(out.split(`.${name}{padding`).length).toBe(2);
    expect(out).toContain(`.${instanceClass({ textAlign: 'center' })}{text-align:center}`);
    expect(out.indexOf('@layer mb-instance{')).toBeGreaterThan(out.indexOf('@layer mb-theme{'));
  });

  it('resolves background images through assetUrl and skips them without one', () => {
    const withImage = {
      variants: {
        default: {
          label: 'D',
          root: {
            id: 'root',
            el: 'section',
            style: {
              base: {
                backgroundImage: { assetId: 'a1', position: 'top' },
                backgroundGradient: { from: 'color:bg/0', to: 'color:bg', angle: 180 },
              },
            },
          },
        },
      },
      default: 'default',
    };
    const out = compileSiteCss({
      theme: defaultTheme(),
      designs: [{ kind: 'block', key: 'k', data: withImage }],
      assetUrl: (id) => `/media/${id}`,
    });
    expect(out).toContain(
      'background-image:linear-gradient(180deg, color-mix(in srgb, var(--mb-color-bg) 0%, transparent), var(--mb-color-bg)), url("/media/a1");background-position:top;background-size:cover;background-repeat:no-repeat',
    );
    const without = compileSiteCss({
      theme: defaultTheme(),
      designs: [{ kind: 'block', key: 'k', data: withImage }],
    });
    expect(without).not.toContain('url("/media');
    const evil = compileSiteCss({
      theme: defaultTheme(),
      designs: [{ kind: 'block', key: 'k', data: withImage }],
      assetUrl: () => '/x");}body{color:red',
    });
    expect(evil).not.toContain('color:red');
  });

  it('appends custom CSS in the last layer and drops it when braces do not balance', () => {
    const out = compileSiteCss({ theme: defaultTheme(), customCss: '.hero{letter-spacing:1px}' });
    expect(out.endsWith('@layer mb-custom{\n.hero{letter-spacing:1px}\n}')).toBe(true);
    expect(compileSiteCss({ theme: defaultTheme(), customCss: '}body{color:red' })).not.toContain(
      'color:red',
    );
    expect(compileSiteCss({ theme: defaultTheme(), customCss: '</style><script>' })).not.toContain(
      '<script>',
    );
  });

  it('never emits invalid values from unvalidated input', () => {
    const theme = defaultTheme();
    theme.colors.palette.evil = 'red;}body{display:none';
    theme.space.x = '1rem;}';
    const bad = {
      variants: {
        default: {
          label: 'D',
          root: {
            id: 'root',
            el: 'box',
            style: { base: { color: 'red;}', padding: '12px', width: 'expression(1)' } },
          },
        },
      },
      default: 'default',
    };
    const out = compileSiteCss({ theme, designs: [{ kind: 'block', key: 'k', data: bad }] });
    expect(out).not.toContain('display:none;');
    expect(out).not.toContain('red;}');
    expect(out).not.toContain('expression');
    expect(out).not.toContain(classFor('block', 'k', 'root'));
    const badId = {
      ...bad,
      variants: {
        default: {
          label: 'D',
          root: { id: 'x{}', el: 'box', style: { base: { padding: 'space:1' } } },
        },
      },
    };
    expect(
      compileSiteCss({
        theme: defaultTheme(),
        designs: [{ kind: 'block', key: 'k', data: badId }],
      }),
    ).not.toContain('x{}');
  });

  it('emits menu presets, level styles, current links and mobile behaviour', () => {
    for (const starter of starterThemes()) {
      for (const [key, menu] of Object.entries(starter.menus)) {
        const out = compileSiteCss({
          theme: starter.theme,
          designs: [{ kind: 'menu', key, data: menu }],
        });
        const x = `.${menuClass(key)}`;
        expect(out).toContain(`${x} .mb-menu-list{list-style:none;margin:0;padding:0}`);
        expect(out).toContain(`${x} .mb-menu-l0{`);
        if (menu.mobile.behaviour !== 'none') {
          const query =
            menu.mobile.breakpoint === 'mobile'
              ? '@media (max-width:639px)'
              : '@media (max-width:1023px)';
          expect(out).toContain(`${query}{\n${x} .mb-menu-toggle{display:inline-flex`);
          expect(out).toContain(`${x}[data-open] .mb-menu-panel{`);
        }
      }
    }
    const neutral = starterThemes()[0];
    const out = compileSiteCss({
      theme: neutral?.theme as ThemeDesign,
      designs: [{ kind: 'menu', key: 'main', data: neutral?.menus.main }],
    });
    const x = `.${menuClass('main')}`;
    expect(out).toContain(
      `${x} .mb-menu-item:hover>.mb-menu-l1,${x} .mb-menu-item:focus-within>.mb-menu-l1`,
    );
    expect(out).toContain(
      `${x} .mb-menu-l0>.mb-menu-item>.mb-menu-link[aria-current]{color:var(--mb-color-primary)}`,
    );
    expect(out).toContain(
      `${x} .mb-menu-l0>.mb-menu-item>.mb-menu-link:hover{color:var(--mb-color-primary)}`,
    );
    expect(out).toContain(`${x} .mb-menu-l2{display:none}`);
  });

  it('ignores theme and site designs in the design list', () => {
    const out = compileSiteCss({
      theme: defaultTheme(),
      designs: [
        { kind: 'site', key: 'default', data: {} },
        { kind: 'theme', key: 'default', data: {} },
      ],
    });
    expect(out).not.toContain('@layer mb-design{');
  });
});
