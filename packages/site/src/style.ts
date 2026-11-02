import { BREAKPOINT_MAX } from '@manablox/public-sdk';
import { WEIGHTS } from './patterns.js';
import type {
  BackgroundGradient,
  BackgroundImage,
  StylePropName,
  StyleProps,
  StyleRules,
  TokenGroup,
} from './types.js';
import { isRecord } from './util.js';

/** Upper bounds, in CSS pixels, of the two narrower breakpoints; same as the block grid. */
export const SITE_BREAKPOINT_MAX = BREAKPOINT_MAX;

export const STYLE_RULE_KEYS = ['base', 'tablet', 'mobile', 'hover', 'focus', 'active'] as const;

export type StyleRuleKey = (typeof STYLE_RULE_KEYS)[number];

const TOKEN_GROUPS: readonly TokenGroup[] = [
  'color',
  'space',
  'radius',
  'shadow',
  'type',
  'font',
  'container',
];

export const TOKEN_NAME = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,39}$/;
const TOKEN_REF = /^([a-z]+):([a-zA-Z0-9][a-zA-Z0-9-]{0,39})(?:\/(\d{1,3}))?$/;
const SIZE = /^-?(?:\d+|\d*\.\d+)(?:px|rem|em|%|vw|vh|svh|dvh|ch)$/;

export interface TokenRefParts {
  group: TokenGroup;
  name: string;
  /** Opacity percentage, colors only. */
  alpha?: number;
}

/** Splits `color:primary/50` into its parts; `null` when it is not a valid reference. */
export function parseTokenRef(value: unknown): TokenRefParts | null {
  if (typeof value !== 'string') return null;
  const match = TOKEN_REF.exec(value);
  if (!match) return null;
  const group = match[1] as TokenGroup;
  if (!TOKEN_GROUPS.includes(group)) return null;
  const name = match[2] as string;
  if (match[3] === undefined) return { group, name };
  const alpha = Number(match[3]);
  if (group !== 'color' || alpha > 100) return null;
  return { group, name, alpha };
}

/** The custom property of a token, e.g. `--mb-color-primary`. */
export function tokenVar(group: TokenGroup, name: string): string {
  return `--mb-${group}-${name}`;
}

export function isSize(value: unknown): value is string {
  return typeof value === 'string' && (value === '0' || SIZE.test(value));
}

/** `var(--mb-color-primary)` or a `color-mix` for a reference with opacity. */
function colorCss(value: unknown): string | null {
  const ref = parseTokenRef(value);
  if (ref?.group !== 'color') return null;
  const variable = `var(${tokenVar('color', ref.name)})`;
  if (ref.alpha === undefined || ref.alpha === 100) return variable;
  return `color-mix(in srgb, ${variable} ${ref.alpha}%, transparent)`;
}

function tokenCss(group: TokenGroup, value: unknown): string | null {
  const ref = parseTokenRef(value);
  if (ref?.group !== group || ref.alpha !== undefined) return null;
  return `var(${tokenVar(group, ref.name)})`;
}

type Declarations = Array<[string, string]>;

export interface StyleCompileContext {
  /** URL of an asset used as a background image; `null` drops the image. */
  assetUrl?: ((assetId: string) => string | null) | undefined;
}

interface PropSpec {
  /** Error message, or `null` when the value is allowed. */
  check(value: unknown): string | null;
  css(value: unknown, context: StyleCompileContext): Declarations;
}

const enumSpec = (
  property: string,
  values: readonly string[],
  map: Record<string, string> = {},
): PropSpec => ({
  check: (value) =>
    typeof value === 'string' && values.includes(value)
      ? null
      : `must be one of ${values.join(', ')}`,
  css: (value) =>
    typeof value === 'string' && values.includes(value) ? [[property, map[value] ?? value]] : [],
});

const spaceSpec = (properties: string[], auto = false): PropSpec => ({
  check: (value) =>
    value === '0' || (auto && value === 'auto') || tokenCss('space', value)
      ? null
      : `must be a space token${auto ? ', 0 or auto' : ' or 0'}`,
  css: (value) => {
    const css = value === '0' ? '0' : auto && value === 'auto' ? 'auto' : tokenCss('space', value);
    return css ? properties.map((property) => [property, css]) : [];
  },
});

const sizeSpec = (
  property: string,
  keywords: readonly string[] = [],
  container = false,
): PropSpec => {
  const resolve = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    if (keywords.includes(value) || isSize(value)) return value;
    return container ? tokenCss('container', value) : null;
  };
  return {
    check: (value) =>
      resolve(value)
        ? null
        : `must be a size with a unit${keywords.length ? ` or ${keywords.join(', ')}` : ''}${container ? ' or a container token' : ''}`,
    css: (value) => {
      const css = resolve(value);
      return css ? [[property, css]] : [];
    },
  };
};

const colorSpec = (property: string): PropSpec => ({
  check: (value) => (colorCss(value) ? null : 'must be a color token'),
  css: (value) => {
    const css = colorCss(value);
    return css ? [[property, css]] : [];
  },
});

const ALIGN = ['start', 'center', 'end', 'stretch', 'baseline'];
const FLEX_MAP: Record<string, string> = {
  start: 'flex-start',
  end: 'flex-end',
  between: 'space-between',
  around: 'space-around',
  evenly: 'space-evenly',
};
const POSITIONS = ['center', 'top', 'bottom', 'left', 'right'];

function backgroundImageIssue(value: unknown): string | null {
  if (!isRecord(value)) return 'must be an object with an assetId';
  if (typeof value.assetId !== 'string' || value.assetId === '') return 'needs an assetId';
  for (const key of Object.keys(value)) {
    if (!['assetId', 'position', 'size', 'repeat'].includes(key)) return `unknown key ${key}`;
  }
  if (value.position !== undefined && !POSITIONS.includes(value.position as string))
    return `position must be one of ${POSITIONS.join(', ')}`;
  if (value.size !== undefined && !['cover', 'contain', 'auto'].includes(value.size as string))
    return 'size must be cover, contain or auto';
  if (value.repeat !== undefined && typeof value.repeat !== 'boolean')
    return 'repeat must be a boolean';
  return null;
}

function gradientIssue(value: unknown): string | null {
  if (!isRecord(value)) return 'must be an object with from and to';
  for (const key of Object.keys(value)) {
    if (!['from', 'to', 'via', 'angle'].includes(key)) return `unknown key ${key}`;
  }
  if (!colorCss(value.from) || !colorCss(value.to)) return 'from and to must be color tokens';
  if (value.via !== undefined && !colorCss(value.via)) return 'via must be a color token';
  if (
    value.angle !== undefined &&
    (typeof value.angle !== 'number' || !Number.isFinite(value.angle))
  )
    return 'angle must be a number';
  return null;
}

function gradientCss(value: BackgroundGradient): string | null {
  if (gradientIssue(value)) return null;
  const stops = [value.from, value.via, value.to]
    .filter((stop) => stop !== undefined)
    .map((stop) => colorCss(stop));
  const angle = Math.round((value.angle ?? 180) * 100) / 100;
  return `linear-gradient(${angle}deg, ${stops.join(', ')})`;
}

/** A URL as a CSS string; `null` for anything that could break out of it. */
export function cssUrl(url: string): string | null {
  if (/[\n\r\\"<>]/.test(url)) return null;
  return `url("${url}")`;
}

const PROPS: Record<StylePropName, PropSpec> = {
  padding: spaceSpec(['padding']),
  paddingX: spaceSpec(['padding-inline']),
  paddingY: spaceSpec(['padding-block']),
  paddingTop: spaceSpec(['padding-top']),
  paddingRight: spaceSpec(['padding-right']),
  paddingBottom: spaceSpec(['padding-bottom']),
  paddingLeft: spaceSpec(['padding-left']),
  margin: spaceSpec(['margin'], true),
  marginX: spaceSpec(['margin-inline'], true),
  marginY: spaceSpec(['margin-block'], true),
  marginTop: spaceSpec(['margin-top'], true),
  marginRight: spaceSpec(['margin-right'], true),
  marginBottom: spaceSpec(['margin-bottom'], true),
  marginLeft: spaceSpec(['margin-left'], true),
  gap: spaceSpec(['gap']),

  width: sizeSpec('width', ['auto'], true),
  maxWidth: sizeSpec('max-width', ['none'], true),
  minWidth: sizeSpec('min-width'),
  height: sizeSpec('height', ['auto']),
  minHeight: sizeSpec('min-height'),
  maxHeight: sizeSpec('max-height', ['none']),
  aspectRatio: enumSpec('aspect-ratio', [
    '1/1',
    '4/3',
    '3/2',
    '16/9',
    '21/9',
    '3/4',
    '2/3',
    '9/16',
    'auto',
  ]),

  display: enumSpec('display', ['block', 'flex', 'grid', 'inline-flex']),
  direction: enumSpec('flex-direction', ['row', 'column', 'row-reverse', 'column-reverse']),
  wrap: {
    check: (value) => (typeof value === 'boolean' ? null : 'must be a boolean'),
    css: (value) => (typeof value === 'boolean' ? [['flex-wrap', value ? 'wrap' : 'nowrap']] : []),
  },
  align: enumSpec('align-items', ALIGN, FLEX_MAP),
  justify: enumSpec(
    'justify-content',
    ['start', 'center', 'end', 'between', 'around', 'evenly'],
    FLEX_MAP,
  ),
  alignSelf: enumSpec('align-self', [...ALIGN, 'auto'], FLEX_MAP),
  grow: {
    check: (value) => (typeof value === 'boolean' ? null : 'must be a boolean'),
    css: (value) =>
      typeof value === 'boolean'
        ? [
            ['flex-grow', value ? '1' : '0'],
            ['min-width', '0'],
          ]
        : [],
  },
  columns: {
    check: (value) =>
      Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 12
        ? null
        : 'must be a whole number from 1 to 12',
    css: (value) =>
      Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 12
        ? [['grid-template-columns', `repeat(${value}, minmax(0, 1fr))`]]
        : [],
  },

  type: {
    check: (value) => (tokenCss('type', value) ? null : 'must be a type token'),
    css: (value) => {
      const ref = parseTokenRef(value);
      if (ref?.group !== 'type' || ref.alpha !== undefined) return [];
      const base = tokenVar('type', ref.name);
      return [
        ['font-size', `var(${base}-size)`],
        ['line-height', `var(${base}-line-height)`],
        ['font-weight', `var(${base}-weight)`],
        ['letter-spacing', `var(${base}-letter-spacing)`],
      ];
    },
  },
  font: {
    check: (value) => (tokenCss('font', value) ? null : 'must be a font token'),
    css: (value) => {
      const css = tokenCss('font', value);
      return css ? [['font-family', css]] : [];
    },
  },
  fontWeight: {
    check: (value) => (WEIGHTS.includes(value as number) ? null : 'must be 100, 200, ... or 900'),
    css: (value) => (WEIGHTS.includes(value as number) ? [['font-weight', String(value)]] : []),
  },
  fontStyle: enumSpec('font-style', ['normal', 'italic']),
  textAlign: enumSpec('text-align', ['left', 'center', 'right', 'justify']),
  textTransform: enumSpec('text-transform', ['none', 'uppercase', 'lowercase', 'capitalize']),
  textDecoration: enumSpec('text-decoration-line', ['none', 'underline', 'line-through']),

  color: colorSpec('color'),
  background: colorSpec('background-color'),
  // Emitted together with `backgroundGradient` in `styleDeclarations`.
  backgroundImage: {
    check: backgroundImageIssue,
    css: () => [],
  },
  backgroundGradient: {
    check: gradientIssue,
    css: () => [],
  },

  borderWidth: sizeSpec('border-width'),
  borderStyle: enumSpec('border-style', ['solid', 'dashed', 'dotted', 'none']),
  borderColor: colorSpec('border-color'),
  radius: {
    check: (value) =>
      value === '0' || tokenCss('radius', value) ? null : 'must be a radius token or 0',
    css: (value) => {
      const css = value === '0' ? '0' : tokenCss('radius', value);
      return css ? [['border-radius', css]] : [];
    },
  },
  shadow: {
    check: (value) =>
      value === 'none' || tokenCss('shadow', value) ? null : 'must be a shadow token or none',
    css: (value) => {
      const css = value === 'none' ? 'none' : tokenCss('shadow', value);
      return css ? [['box-shadow', css]] : [];
    },
  },

  opacity: {
    check: (value) =>
      typeof value === 'number' && value >= 0 && value <= 1 ? null : 'must be from 0 to 1',
    css: (value) =>
      typeof value === 'number' && value >= 0 && value <= 1
        ? [['opacity', String(Math.round(value * 100) / 100)]]
        : [],
  },
  overflow: enumSpec('overflow', ['visible', 'hidden', 'auto', 'clip']),
  objectFit: enumSpec('object-fit', ['cover', 'contain', 'fill', 'none', 'scale-down']),
  objectPosition: enumSpec('object-position', POSITIONS),
};

/** Every allowed style prop, in emit order. */
export const STYLE_PROP_NAMES = Object.keys(PROPS) as StylePropName[];

/** Issues of one `StyleProps` object as `[propName, message]`. */
export function stylePropsIssues(value: unknown): Array<[string, string]> {
  if (!isRecord(value)) return [['', 'must be an object']];
  const issues: Array<[string, string]> = [];
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    const spec = (PROPS as Record<string, PropSpec | undefined>)[key];
    if (!spec) {
      issues.push([key, 'is not an allowed style property']);
      continue;
    }
    const issue = spec.check(entry);
    if (issue) issues.push([key, issue]);
  }
  return issues;
}

/** CSS declarations of a `StyleProps`, in a fixed order; invalid entries are skipped. */
export function styleDeclarations(props: unknown, context: StyleCompileContext = {}): Declarations {
  if (!isRecord(props)) return [];
  const style = props as StyleProps;
  const out: Declarations = [];
  for (const name of STYLE_PROP_NAMES) {
    const value = style[name];
    if (value === undefined) continue;
    if (name === 'backgroundImage' || name === 'backgroundGradient') continue;
    out.push(...PROPS[name].css(value, context));
  }
  out.push(...backgroundDeclarations(style.backgroundImage, style.backgroundGradient, context));
  return out;
}

function backgroundDeclarations(
  image: BackgroundImage | undefined,
  gradient: BackgroundGradient | undefined,
  context: StyleCompileContext,
): Declarations {
  const layers: string[] = [];
  if (gradient) {
    const css = gradientCss(gradient);
    if (css) layers.push(css);
  }
  let hasImage = false;
  if (image && !backgroundImageIssue(image)) {
    const url = context.assetUrl?.(image.assetId);
    const css = url ? cssUrl(url) : null;
    if (css) {
      layers.push(css);
      hasImage = true;
    }
  }
  if (layers.length === 0) return [];
  const out: Declarations = [['background-image', layers.join(', ')]];
  if (hasImage && image) {
    out.push(['background-position', image.position ?? 'center']);
    out.push(['background-size', image.size ?? 'cover']);
    out.push(['background-repeat', image.repeat ? 'repeat' : 'no-repeat']);
  }
  return out;
}

/** Issues of a `StyleRules` object as `[path, message]`, path relative to the rules. */
export function styleRulesIssues(value: unknown): Array<[string, string]> {
  if (!isRecord(value)) return [['', 'must be an object']];
  const issues: Array<[string, string]> = [];
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    if (!(STYLE_RULE_KEYS as readonly string[]).includes(key)) {
      issues.push([key, `must be one of ${STYLE_RULE_KEYS.join(', ')}`]);
      continue;
    }
    for (const [prop, message] of stylePropsIssues(entry)) {
      issues.push([prop ? `${key}.${prop}` : key, message]);
    }
  }
  return issues;
}

/** Whether any rule of a `StyleRules` has a declaration. */
export function hasStyle(rules: StyleRules | undefined): boolean {
  if (!isRecord(rules)) return false;
  return STYLE_RULE_KEYS.some((key) => isRecord(rules[key]) && Object.keys(rules[key]).length > 0);
}
