import { classFor, defaultTheme, starterThemes, validateSiteDesign } from '@manablox/site';
import { describe, expect, it } from 'vitest';
import { compileDraftCss, siteOrigins } from '../../src/admin/model/canvas';
import { checkContrast, contrastRatio, parseColor, toHex } from '../../src/admin/model/color';
import { familyFromFilename, styleFromFilename, withoutFamily } from '../../src/admin/model/fonts';
import { inheritedValue, setStyleProps } from '../../src/admin/model/style';
import { styleGuideInput } from '../../src/admin/model/style-guide';
import {
  colorRefCss,
  joinColorRef,
  splitColorRef,
  tokenOptions,
} from '../../src/admin/model/tokens';

const ASSETS = {
  fontData: (id: string) => (id === 'a1' ? 'data:font/woff2;base64,AAAA' : null),
  mediaOrigin: 'http://admin.test',
};

const SPACE = { id: 's1', name: 'Acme', defaultLocale: 'en', locales: ['en', 'de'] };

describe('colors', () => {
  it('reads hex, rgb and hsl and skips what it cannot compute', () => {
    expect(parseColor('#fff')).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(toHex('rgb(37 99 235)')).toBe('#2563eb');
    expect(toHex('hsl(0 100% 50%)')).toBe('#ff0000');
    expect(parseColor('oklch(0.6 0.2 250)')).toBeNull();
  });

  it('computes WCAG ratios', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(contrastRatio('oklch(0.5 0 0)', '#fff')).toBeNull();
  });

  it('checks the role pairs of both schemes, resolving palette names', () => {
    const theme = defaultTheme();
    const light = checkContrast(theme.colors);
    expect(light.find((check) => check.text === 'text' && check.background === 'bg')?.ok).toBe(
      true,
    );
    const dark = checkContrast(theme.colors, 'dark');
    expect(dark.every((check) => check.ratio !== null)).toBe(true);
    const bad = checkContrast({
      ...theme.colors,
      roles: { ...theme.colors.roles, text: '#eeeeee' },
    });
    expect(bad.find((check) => check.text === 'text' && check.background === 'bg')?.ok).toBe(false);
  });
});

describe('tokens', () => {
  it('offers roles before palette colors, with swatches', () => {
    const options = tokenOptions(defaultTheme(), 'color');
    expect(options[0]).toMatchObject({ value: 'color:bg', label: 'Background', swatch: '#ffffff' });
    expect(options.some((option) => option.value === 'color:blue600')).toBe(true);
  });

  it('sorts numeric scales by value', () => {
    const values = tokenOptions(defaultTheme(), 'space').map((option) => option.value);
    expect(values.indexOf('space:2')).toBeLessThan(values.indexOf('space:10'));
  });

  it('splits and joins color references with opacity', () => {
    expect(splitColorRef('color:primary/40')).toEqual({ ref: 'color:primary', alpha: 40 });
    expect(joinColorRef('color:primary', 100)).toBe('color:primary');
    expect(joinColorRef('color:primary', 55)).toBe('color:primary/55');
  });
});

describe('style rules', () => {
  it('sets and clears props per target, dropping empty rules', () => {
    const rules = setStyleProps(undefined, 'base', { gap: 'space:4' });
    expect(rules).toEqual({ base: { gap: 'space:4' } });
    const mobile = setStyleProps(rules, 'mobile', { gap: 'space:2' });
    expect(inheritedValue(mobile, 'mobile', 'gap')).toBe('space:4');
    expect(inheritedValue(mobile, 'hover', 'gap')).toBe('space:4');
    expect(
      setStyleProps(setStyleProps(mobile, 'mobile', { gap: undefined }), 'base', {
        gap: undefined,
      }),
    ).toBeUndefined();
  });
});

describe('fonts', () => {
  it('guesses family, weight and style from a file name', () => {
    expect(familyFromFilename('Acme-BoldItalic.woff2')).toBe('Acme');
    expect(styleFromFilename('Acme-SemiBold.woff2')).toEqual({ weight: 600, style: 'normal' });
    expect(styleFromFilename('Acme-BoldItalic.woff2')).toEqual({ weight: 700, style: 'italic' });
  });

  it('keeps a family a role uses', () => {
    const fonts = defaultTheme().fonts;
    expect(withoutFamily(fonts, 'inter')).toBe(fonts);
    expect(withoutFamily(fonts, 'jetbrains-mono').families).toHaveLength(fonts.families.length);
  });
});

describe('style guide', () => {
  it('builds a valid page and layout and compiles their classes', () => {
    const theme = defaultTheme();
    const input = styleGuideInput(theme, SPACE);
    expect(validateSiteDesign('page', input.page.design).ok).toBe(true);
    expect(validateSiteDesign('layout', input.layout.design).ok).toBe(true);
    // The sample form asks for the fields of a databag type the guide brings along.
    const form = JSON.stringify(input.page.design);
    expect(form).toContain('"el":"formField"');
    expect(Object.values(input.contentTypes).some((type) => type.kind === 'data')).toBe(true);
    const css = compileDraftCss(
      theme,
      [{ kind: 'page', key: input.page.key, data: input.page.design }],
      ASSETS,
    );
    expect(css).toContain(`.${classFor('page', input.page.key, 'swatches')}`);
    expect(css).toContain('/_site/fonts/inter/');
  });

  it('inlines loaded asset fonts and skips the rest', () => {
    const theme = defaultTheme();
    theme.fonts.families.push({
      id: 'acme',
      name: 'Acme',
      source: 'asset',
      files: [
        { assetId: 'a1', weight: 400, style: 'normal' },
        { assetId: 'a2', weight: 700, style: 'normal' },
      ],
      fallback: 'sans-serif',
    });
    const css = compileDraftCss(theme, [], ASSETS);
    expect(css).toContain('url("data:font/woff2;base64,AAAA")');
    expect(css.match(/font-family:"Acme"/g)).toHaveLength(1);
  });
});

describe('site origins', () => {
  it('frames the configured site URL and links the primary domain', () => {
    const domains = [
      { hostname: 'de.acme.test', isPrimary: true, locale: 'de' },
      { hostname: 'www.acme.com', isPrimary: true, locale: null },
    ];
    expect(siteOrigins('http://localhost:3200/', domains)).toEqual({
      canvas: 'http://localhost:3200',
      live: 'https://www.acme.com',
    });
    expect(siteOrigins(null, [domains[0] as (typeof domains)[number]])).toEqual({
      canvas: 'http://de.acme.test',
      live: 'http://de.acme.test',
    });
    expect(siteOrigins(null)).toEqual({ canvas: null, live: null });
    expect(
      siteOrigins('http://localhost:3012', [
        { hostname: 'localhost', isPrimary: true, locale: null },
      ]),
    ).toEqual({
      canvas: 'http://localhost:3012',
      live: 'http://localhost:3012',
    });
  });
});

describe('colorRefCss', () => {
  it('resolves a role for the light or the dark scheme, with opacity', () => {
    const theme = defaultTheme();
    theme.colors.roles.text = '#111111';
    theme.colors.dark = { ...theme.colors.dark, text: '#eeeeee' };
    expect(colorRefCss(theme, 'color:text')).toBe('#111111');
    expect(colorRefCss(theme, 'color:text', 'dark')).toBe('#eeeeee');
    expect(colorRefCss(theme, 'color:text/50', 'dark')).toBe(
      'color-mix(in srgb, #eeeeee 50%, transparent)',
    );
    expect(colorRefCss(theme, 'space:4')).toBeNull();
  });
});

describe('starter themes', () => {
  it('pass every text contrast check in both schemes', () => {
    const failing = starterThemes().flatMap((starter) =>
      (['light', 'dark'] as const).flatMap((scheme) =>
        checkContrast(starter.theme.colors, scheme)
          .filter((check) => check.needs === 'aa' && check.ok !== true)
          .map((check) => `${starter.id} ${scheme}: ${check.label} ${check.ratio?.toFixed(2)}`),
      ),
    );
    expect(failing).toEqual([]);
  });
});
