import { describe, expect, it } from 'vitest';
import {
  type BlockDesign,
  defaultSiteSettings,
  designFieldPaths,
  findBrokenBindings,
  generateBlockDesign,
  remapDesignFields,
  siteHasCode,
  starterBundle,
  starterThemes,
  THEME_BUNDLE_FORMAT,
  type ThemeBundle,
  validateThemeBundle,
  withoutSiteCode,
} from '../src/index.js';
import { field, typeWith } from './fixtures.js';

const source = typeWith([
  field('headline', 'string', {}, { id: 'src-headline', name: 'headline' }),
  field(
    'quotes',
    'repeater',
    { fields: [{ id: 'src-quote', name: 'quote', type: 'string' }] },
    { id: 'src-quotes', name: 'quotes' },
  ),
]);
const target = typeWith([
  field('headline', 'string', {}, { id: 'dst-headline', name: 'headline' }),
  field(
    'quotes',
    'repeater',
    { fields: [{ id: 'dst-quote', name: 'quote', type: 'string' }] },
    { id: 'dst-quotes', name: 'quotes' },
  ),
]);

const bundle = (overrides: Partial<ThemeBundle> = {}): ThemeBundle => ({
  ...starterBundle(starterThemes()[0] as never),
  ...overrides,
});

describe('validateThemeBundle', () => {
  it('accepts every built-in starter theme as a bundle', () => {
    for (const starter of starterThemes()) {
      const result = validateThemeBundle(starterBundle(starter));
      expect(result.ok).toBe(true);
    }
  });

  it('accepts block designs with a type reference and site settings', () => {
    const result = validateThemeBundle(
      bundle({
        designs: [
          {
            kind: 'block',
            key: 'type-1',
            type: { id: 'type-1', name: 'teaser', fields: designFieldPaths(source.fields) },
            data: generateBlockDesign(source),
          },
        ],
        site: { ...defaultSiteSettings(), name: 'Acme' },
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('refuses stray JSON and unknown versions', () => {
    expect(validateThemeBundle({ hello: 1 })).toMatchObject({
      ok: false,
      issues: [{ path: 'format' }],
    });
    expect(validateThemeBundle({ format: THEME_BUNDLE_FORMAT, version: 2 })).toMatchObject({
      ok: false,
      issues: [{ path: 'version' }],
    });
  });

  it('points issues at the design inside the file', () => {
    const result = validateThemeBundle(
      bundle({
        designs: [
          { kind: 'layout', key: 'wide', data: { root: { id: 'r', el: 'nope' } } as never },
          { kind: 'layout', key: 'wide', data: { root: { id: 'r', el: 'slot' } } },
          { kind: 'theme' as never, key: 'x', data: {} as never },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    const paths = result.ok ? [] : result.issues.map((issue) => issue.path);
    expect(paths.some((path) => path.startsWith('designs.0.data.root'))).toBe(true);
    expect(paths).toContain('designs.1.key');
    expect(paths).toContain('designs.2.kind');
  });
});

describe('site code', () => {
  it('detects and strips custom CSS, head and body code', () => {
    const site = { ...defaultSiteSettings(), customCss: 'a{}', headCode: '<meta>' };
    expect(siteHasCode(site)).toBe(true);
    const stripped = withoutSiteCode(site);
    expect(siteHasCode(stripped)).toBe(false);
    expect(stripped.name).toBe('');
    expect(site.customCss).toBe('a{}');
  });
});

describe('remapDesignFields', () => {
  it('maps field id paths to names, sub-fields included', () => {
    expect(designFieldPaths(source.fields)).toEqual({
      'src-headline': 'headline',
      'src-quotes': 'quotes',
      'src-quotes.src-quote': 'quotes.quote',
    });
  });

  it('rebinds a design to the target type by field name', () => {
    const design = generateBlockDesign(source);
    expect(findBrokenBindings(design, target).length).toBeGreaterThan(0);
    const remapped = remapDesignFields(
      'block',
      design,
      designFieldPaths(source.fields),
      designFieldPaths(target.fields),
    ) as BlockDesign;
    expect(findBrokenBindings(remapped, target)).toEqual([]);
    const text = JSON.stringify(remapped);
    expect(text).toContain('dst-quotes.dst-quote');
    expect(text).not.toContain('src-');
    // The input stays as it was.
    expect(JSON.stringify(design)).toContain('src-headline');
  });

  it('maps the head of a related document path and keeps its field name', () => {
    const items = typeWith([field('items', 'content', { multiple: true }, { id: 'dst-items' })]);
    const design: BlockDesign = {
      default: 'default',
      variants: {
        default: {
          label: 'Default',
          root: {
            id: 'root',
            el: 'repeat',
            bind: { field: 'items' },
            children: [
              { id: 'name', el: 'text', bind: { field: 'items.$item' } },
              { id: 'quote', el: 'text', bind: { field: 'items.quote' } },
            ],
          },
        },
      },
    };
    const remapped = remapDesignFields(
      'block',
      design,
      { items: 'items' },
      designFieldPaths(items.fields),
    ) as BlockDesign;
    const text = JSON.stringify(remapped);
    expect(text).toContain('"dst-items.$item"');
    expect(text).toContain('"dst-items.quote"');
    // Related fields are only known when rendering.
    expect(findBrokenBindings(remapped, items)).toEqual([]);
  });
});

describe('validateThemeBundle type references', () => {
  it('accepts machine names with hyphens', () => {
    const result = validateThemeBundle(
      bundle({
        designs: [
          {
            kind: 'block',
            key: 'call-to-action',
            type: { name: 'call-to-action' },
            data: generateBlockDesign({ fields: [] }),
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });
});
