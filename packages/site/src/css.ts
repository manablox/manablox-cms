import { BLOCK_GRID_CSS } from '@manablox/public-sdk';
import {
  BUTTON_CLASS,
  buttonClass,
  CONTAINER_CLASS,
  classFor,
  containerClass,
  elementClass,
  FORM_ERROR_CLASS,
  HONEYPOT_CLASS,
  hiddenClass,
  INPUT_CLASS,
  instanceClass,
  LABEL_CLASS,
  MENU_CLASSES,
  menuClass,
  menuLevelClass,
  normalizeInstanceStyle,
  PROSE_CLASS,
  SCHEME_ATTRIBUTE,
  SR_ONLY_CLASS,
} from './classes.js';
import { BUTTON_VARIANTS } from './elements.js';
import {
  BUNDLED_PATH,
  COLOR,
  FONT_FALLBACK,
  FONT_NAME,
  FONT_WEIGHT,
  SHADOW,
  WEIGHTS,
} from './patterns.js';
import {
  isSize,
  parseTokenRef,
  SITE_BREAKPOINT_MAX,
  type StyleCompileContext,
  styleDeclarations,
  TOKEN_NAME,
  tokenVar,
} from './style.js';
import { designRoots, NODE_ID, walkNodes } from './tree.js';
import {
  COLOR_ROLES,
  type FontFamily,
  type FontFile,
  type InstanceStyle,
  type MenuDesign,
  type SiteDesignKind,
  type StyleProps,
  type StyleRules,
  type TextDefaults,
  type ThemeDesign,
  TYPE_STEPS,
} from './types.js';
import { asRecord, cssBracesBalanced, isRecord } from './util.js';

export interface SiteCssDesign {
  kind: SiteDesignKind;
  key: string;
  data: unknown;
}

export interface SiteCssInput {
  theme: ThemeDesign;
  /** Block, page, layout and menu designs; other kinds are ignored. */
  designs?: SiteCssDesign[];
  /** Overrides used by block instances; each gets its `instanceClass`. */
  instanceStyles?: Array<InstanceStyle | null | undefined>;
  /** Appended in the last cascade layer; dropped when its braces do not balance. */
  customCss?: string | null;
  /** URL of a font file; `null` skips it. Defaults to `/_site/fonts/<bundledPath>` for bundled files. */
  fontUrl?: (file: FontFile, family: FontFamily) => string | null;
  /** URL of an asset used as a background image. Without it, background images are skipped. */
  assetUrl?: (assetId: string) => string | null;
}

export const SITE_CSS_LAYERS = ['mb-reset', 'mb-theme', 'mb-design', 'mb-instance', 'mb-custom'];

const TABLET = `@media (max-width:${SITE_BREAKPOINT_MAX.tablet}px)`;
const MOBILE = `@media (max-width:${SITE_BREAKPOINT_MAX.mobile}px)`;
const DESIGN_ORDER: SiteDesignKind[] = ['layout', 'page', 'block', 'menu'];

type Declarations = Array<[string, string]>;

const rule = (selector: string, declarations: Declarations): string =>
  declarations.length === 0
    ? ''
    : `${selector}{${declarations.map(([property, value]) => `${property}:${value}`).join(';')}}`;

/** Rules split by where they go: plain, or inside the tablet or mobile query. */
class Sheet {
  readonly main: string[] = [];
  readonly tablet: string[] = [];
  readonly mobile: string[] = [];

  add(target: 'main' | 'tablet' | 'mobile', css: string): void {
    if (css) this[target].push(css);
  }

  /** Emits `rules` for `selector`: base, states, then the breakpoints. */
  rules(selector: string, value: unknown, context: StyleCompileContext): void {
    if (!isRecord(value)) return;
    const rules = value as StyleRules;
    const selectors = selector.split(',');
    const withSuffix = (suffix: string) => selectors.map((entry) => `${entry}${suffix}`).join(',');
    this.add('main', rule(selector, styleDeclarations(rules.base, context)));
    this.add('main', rule(withSuffix(':hover'), styleDeclarations(rules.hover, context)));
    this.add('main', rule(withSuffix(':focus-visible'), styleDeclarations(rules.focus, context)));
    this.add('main', rule(withSuffix(':active'), styleDeclarations(rules.active, context)));
    this.add('tablet', rule(selector, styleDeclarations(rules.tablet, context)));
    this.add('mobile', rule(selector, styleDeclarations(rules.mobile, context)));
  }

  props(selector: string, props: unknown, context: StyleCompileContext): void {
    this.add('main', rule(selector, styleDeclarations(props, context)));
  }

  toString(): string {
    const out = [...this.main];
    if (this.tablet.length) out.push(`${TABLET}{${this.tablet.join('')}}`);
    if (this.mobile.length) out.push(`${MOBILE}{${this.mobile.join('')}}`);
    return out.join('\n');
  }
}

const layer = (name: string, body: string): string => (body ? `@layer ${name}{\n${body}\n}` : '');

function defaultFontUrl(file: FontFile, family: FontFamily): string | null {
  if (family.source === 'bundled' && file.bundledPath && BUNDLED_PATH.test(file.bundledPath))
    return `/_site/fonts/${file.bundledPath}`;
  return null;
}

function fontFaces(theme: ThemeDesign, fontUrl: SiteCssInput['fontUrl']): string {
  const out: string[] = [];
  for (const family of theme.fonts?.families ?? []) {
    if (!FONT_NAME.test(family.name ?? '')) continue;
    for (const file of family.files ?? []) {
      const url = (fontUrl ?? defaultFontUrl)(file, family);
      if (!url || /[\n\r\\"<>]/.test(url)) continue;
      const weight = String(file.weight);
      if (!(WEIGHTS.includes(file.weight as number) || FONT_WEIGHT.test(weight))) continue;
      const style = file.style === 'italic' ? 'italic' : 'normal';
      out.push(
        `@font-face{font-family:"${family.name}";src:url("${url}") format("woff2");font-weight:${weight};font-style:${style};font-display:swap}`,
      );
    }
  }
  return out.join('\n');
}

function resetCss(): string {
  const e = elementClass;
  return [
    '*,*::before,*::after{box-sizing:border-box}',
    'html{-webkit-text-size-adjust:100%;text-size-adjust:100%}',
    'body{margin:0;min-height:100vh}',
    'h1,h2,h3,h4,h5,h6,p,figure,blockquote{margin:0}',
    'img,video,svg{display:block;max-width:100%;height:auto}',
    BLOCK_GRID_CSS,
    `.${e('box')}{min-width:0}`,
    `.${e('stack')}{display:flex;flex-direction:column;min-width:0}`,
    `.${e('grid')}{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(16rem,100%),1fr));min-width:0}`,
    `.${e('repeat')}{display:flex;flex-direction:column}`,
    `.${e('section')}{width:100%}`,
    `.${CONTAINER_CLASS}{width:100%;max-width:var(--mb-container-default);margin-inline:auto;padding-inline:var(--mb-container-gutter)}`,
    `.${e('spacer')}{height:var(--mb-space-8,2rem)}`,
    `.${e('divider')}{border:0;border-top:1px solid var(--mb-color-border);margin:0;width:100%}`,
    `.${e('image')}{object-fit:cover}`,
    `.${e('video')}{width:100%}`,
    `.${e('embed')}{display:block;width:100%;aspect-ratio:16/9;border:0}`,
    `.${e('icon')}{display:inline-block;width:1.25em;height:1.25em;flex-shrink:0}`,
    `.${BUTTON_CLASS}{display:inline-flex;align-items:center;justify-content:center;gap:0.5em;cursor:pointer;text-decoration:none;font:inherit;line-height:1.2}`,
    `.${e('form')}{display:flex;flex-direction:column}`,
    `.${e('formField')}{display:flex;flex-direction:column;gap:0.25rem}`,
    `.${INPUT_CLASS}{font:inherit;color:inherit;width:100%}`,
    `.${e('formMessage')}[hidden]{display:none}`,
    `.${FORM_ERROR_CLASS}{margin:0;font-size:0.875em;color:#b42318}`,
    `.${INPUT_CLASS}[aria-invalid="true"]{border-color:#b42318}`,
    `.${HONEYPOT_CLASS}{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}`,
    `.${SR_ONLY_CLASS}{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}`,
    `.${e('breadcrumbs')} ol{display:flex;flex-wrap:wrap;gap:0.5em;list-style:none;margin:0;padding:0}`,
    `.${e('localeSwitch')} ul{display:flex;gap:0.5em;list-style:none;margin:0;padding:0}`,
    `@media (min-width:${SITE_BREAKPOINT_MAX.tablet + 1}px){.${hiddenClass('desktop')}{display:none!important}}`,
    `@media (min-width:${SITE_BREAKPOINT_MAX.mobile + 1}px) and (max-width:${SITE_BREAKPOINT_MAX.tablet}px){.${hiddenClass('tablet')}{display:none!important}}`,
    `@media (max-width:${SITE_BREAKPOINT_MAX.mobile}px){.${hiddenClass('mobile')}{display:none!important}}`,
  ].join('\n');
}

function colorValue(value: unknown, palette: Record<string, unknown>): string | null {
  if (typeof value !== 'string') return null;
  if (Object.hasOwn(palette, value) && TOKEN_NAME.test(value))
    return `var(${tokenVar('color', value)})`;
  return COLOR.test(value) ? value : null;
}

function sizeTokens(group: 'space' | 'radius', values: unknown): Declarations {
  if (!isRecord(values)) return [];
  return Object.entries(values)
    .filter(([name, value]) => TOKEN_NAME.test(name) && isSize(value))
    .map(([name, value]) => [tokenVar(group, name), value as string]);
}

function spaceRefCss(value: unknown): string | null {
  const ref = parseTokenRef(value);
  return ref?.group === 'space' ? `var(${tokenVar('space', ref.name)})` : null;
}

function textDefaults(value: TextDefaults | undefined): Declarations {
  if (!isRecord(value)) return [];
  const out: Declarations = [];
  if (['body', 'heading', 'mono'].includes(value.font))
    out.push(['font-family', `var(--mb-font-${value.font})`]);
  if ((TYPE_STEPS as readonly string[]).includes(value.type)) {
    const base = tokenVar('type', value.type);
    out.push(
      ['font-size', `var(${base}-size)`],
      ['line-height', `var(${base}-line-height)`],
      [
        'font-weight',
        WEIGHTS.includes(value.weight as number) ? String(value.weight) : `var(${base}-weight)`,
      ],
      ['letter-spacing', `var(${base}-letter-spacing)`],
    );
  }
  const color = styleDeclarations(value.color ? { color: value.color } : undefined);
  out.push(...color);
  if (
    value.textTransform &&
    ['none', 'uppercase', 'lowercase', 'capitalize'].includes(value.textTransform)
  )
    out.push(['text-transform', value.textTransform]);
  return out;
}

function themeCss(theme: ThemeDesign, context: StyleCompileContext): string {
  const root: Declarations = [];
  const mobileRoot: Declarations = [];
  const palette = asRecord(theme.colors?.palette);

  for (const [name, value] of Object.entries(palette)) {
    if (TOKEN_NAME.test(name) && typeof value === 'string' && COLOR.test(value))
      root.push([tokenVar('color', name), value]);
  }
  const roles = asRecord(theme.colors?.roles);
  for (const role of COLOR_ROLES) {
    const css = colorValue(roles[role], palette);
    if (css) root.push([tokenVar('color', role), css]);
  }

  const families = Array.isArray(theme.fonts?.families) ? theme.fonts.families : [];
  for (const family of families) {
    if (!TOKEN_NAME.test(family.id ?? '') || !FONT_NAME.test(family.name ?? '')) continue;
    const fallback =
      FONT_FALLBACK.test(family.fallback ?? '') && family.fallback ? `, ${family.fallback}` : '';
    root.push([tokenVar('font', family.id), `"${family.name}"${fallback}`]);
  }
  const fontRoles = asRecord(theme.fonts?.roles);
  for (const role of ['body', 'heading', 'mono'] as const) {
    const id = fontRoles[role];
    const known = families.some((family) => family.id === id);
    root.push([
      tokenVar('font', role),
      known && typeof id === 'string' && TOKEN_NAME.test(id)
        ? `var(${tokenVar('font', id)})`
        : role === 'mono'
          ? 'ui-monospace, monospace'
          : 'system-ui, sans-serif',
    ]);
  }

  const type = asRecord(theme.type);
  for (const step of TYPE_STEPS) {
    const entry = type[step];
    if (!isRecord(entry)) continue;
    const base = tokenVar('type', step);
    if (isSize(entry.size)) root.push([`${base}-size`, entry.size]);
    if (typeof entry.lineHeight === 'number' && entry.lineHeight > 0 && entry.lineHeight <= 3)
      root.push([`${base}-line-height`, String(entry.lineHeight)]);
    if (WEIGHTS.includes(entry.weight as number))
      root.push([`${base}-weight`, String(entry.weight)]);
    root.push([
      `${base}-letter-spacing`,
      isSize(entry.letterSpacing) ? entry.letterSpacing : 'normal',
    ]);
    if (isSize(entry.mobileSize)) mobileRoot.push([`${base}-size`, entry.mobileSize]);
  }

  root.push(...sizeTokens('space', theme.space), ...sizeTokens('radius', theme.radius));
  if (isRecord(theme.shadow)) {
    for (const [name, value] of Object.entries(theme.shadow)) {
      if (TOKEN_NAME.test(name) && typeof value === 'string' && SHADOW.test(value))
        root.push([tokenVar('shadow', name), value]);
    }
  }
  const container = isRecord(theme.container) ? theme.container : null;
  const widths = asRecord(container?.widths);
  for (const [name, value] of Object.entries(widths)) {
    if (TOKEN_NAME.test(name) && isSize(value)) root.push([tokenVar('container', name), value]);
  }
  const defaultWidth = container?.default;
  root.push([
    '--mb-container-default',
    typeof defaultWidth === 'string' &&
    TOKEN_NAME.test(defaultWidth) &&
    Object.hasOwn(widths, defaultWidth)
      ? `var(${tokenVar('container', defaultWidth)})`
      : '64rem',
  ]);
  root.push(['--mb-container-gutter', spaceRefCss(container?.gutter) ?? '1rem']);

  const dark: Declarations = [];
  if (isRecord(theme.colors?.dark)) {
    for (const role of COLOR_ROLES) {
      const css = colorValue(theme.colors.dark[role], palette);
      if (css) dark.push([tokenVar('color', role), css]);
    }
  }
  root.push(['color-scheme', dark.length ? 'light dark' : 'light']);

  const out: string[] = [rule(':root', root)];
  if (mobileRoot.length) out.push(`${MOBILE}{${rule(':root', mobileRoot)}}`);
  if (dark.length) {
    const darkDeclarations: Declarations = [...dark, ['color-scheme', 'dark']];
    out.push(
      `@media (prefers-color-scheme:dark){${rule(`:root:not([${SCHEME_ATTRIBUTE}=light])`, darkDeclarations)}}`,
      rule(`:root[${SCHEME_ATTRIBUTE}=dark]`, darkDeclarations),
    );
    out.push(rule(`:root[${SCHEME_ATTRIBUTE}=light]`, [['color-scheme', 'light']]));
  }

  const sheet = new Sheet();
  sheet.add(
    'main',
    rule('body', [
      ['background-color', 'var(--mb-color-bg)'],
      ['color', 'var(--mb-color-text)'],
      ...textDefaults(theme.body),
    ]),
  );
  const headings = asRecord(theme.headings);
  for (const level of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const) {
    sheet.add('main', rule(level, textDefaults(headings[level] as TextDefaults | undefined)));
  }
  sheet.add('main', 'code,kbd,pre,samp{font-family:var(--mb-font-mono)}');
  const elements = asRecord(theme.elements);
  sheet.rules('body', elements.body, context);
  // Buttons rendered as links keep their own look; `:where` keeps `a`'s specificity.
  sheet.rules(`a:where(:not(.${BUTTON_CLASS}))`, elements.link, context);
  sheet.rules(`.${BUTTON_CLASS}`, elements.button, context);
  const buttons = asRecord(elements.buttons);
  for (const variant of BUTTON_VARIANTS)
    sheet.rules(`.${buttonClass(variant)}`, buttons[variant], context);
  sheet.rules(`.${INPUT_CLASS}`, elements.input, context);
  sheet.rules(`.${LABEL_CLASS}`, elements.label, context);
  for (const name of Object.keys(widths)) {
    if (TOKEN_NAME.test(name))
      sheet.add(
        'main',
        rule(`.${containerClass(name)}`, [['max-width', `var(${tokenVar('container', name)})`]]),
      );
  }
  sheet.add('main', proseCss());
  sheet.rules(`.${PROSE_CLASS}`, elements.prose, context);

  return [...out, sheet.toString()].filter(Boolean).join('\n');
}

function proseCss(): string {
  const p = `.${PROSE_CLASS}`;
  return [
    `${p}>*+*{margin-top:var(--mb-space-4,1rem)}`,
    `${p}>:is(h1,h2,h3,h4,h5,h6)+*{margin-top:var(--mb-space-3,0.75rem)}`,
    `${p}>*+:is(h1,h2,h3){margin-top:var(--mb-space-10,2.5rem)}`,
    `${p}>*+:is(h4,h5,h6){margin-top:var(--mb-space-8,2rem)}`,
    `${p} :is(ul,ol){padding-inline-start:1.5em}`,
    `${p} li+li{margin-top:var(--mb-space-1,0.25rem)}`,
    `${p} blockquote{padding-inline-start:var(--mb-space-4,1rem);border-inline-start:3px solid var(--mb-color-border);color:var(--mb-color-muted)}`,
    `${p} pre{padding:var(--mb-space-4,1rem);background:var(--mb-color-surface);border-radius:var(--mb-radius-md,0.5rem);overflow-x:auto}`,
    `${p} :not(pre)>code{padding:0.1em 0.3em;background:var(--mb-color-surface);border-radius:var(--mb-radius-sm,0.25rem);font-size:0.9em}`,
    `${p} hr{border:0;border-top:1px solid var(--mb-color-border)}`,
    `${p} img{border-radius:var(--mb-radius-md,0.5rem)}`,
    `${p} table{width:100%;border-collapse:collapse}`,
    `${p} :is(th,td){padding:var(--mb-space-2,0.5rem);border-bottom:1px solid var(--mb-color-border);text-align:start}`,
  ].join('\n');
}

function designCss(design: SiteCssDesign, sheet: Sheet, context: StyleCompileContext): void {
  for (const root of designRoots(design.kind, design.data)) {
    walkNodes(root, ({ node }) => {
      if (!isRecord(node) || typeof node.id !== 'string' || !NODE_ID.test(node.id)) return false;
      sheet.rules(`.${classFor(design.kind, design.key, node.id)}`, node.style, context);
      return undefined;
    });
  }
}

const PRESET_CSS: Record<MenuDesign['preset'], (x: string) => string[]> = {
  bar: (x) => [
    `${x} .mb-menu-l0{display:flex;flex-wrap:wrap;align-items:center}`,
    `${x} .mb-menu-l1{display:none}`,
  ],
  list: (x) => [
    `${x} .mb-menu-l0{display:flex;flex-direction:column}`,
    `${x} .mb-menu-l1,${x} .mb-menu-l2{display:flex;flex-direction:column;padding-inline-start:var(--mb-space-4,1rem)}`,
  ],
  dropdown: (x) => [
    `${x} .mb-menu-l0{display:flex;flex-wrap:wrap;align-items:center}`,
    `${x} .mb-menu-l0>.mb-menu-item{position:relative}`,
    `${x} .mb-menu-l1{display:none;position:absolute;top:100%;left:0;z-index:50;min-width:12rem;flex-direction:column}`,
    `${x} .mb-menu-item:hover>.mb-menu-l1,${x} .mb-menu-item:focus-within>.mb-menu-l1,${x} .mb-menu-item[data-open]>.mb-menu-l1{display:flex}`,
    `${x} .mb-menu-l2{display:flex;flex-direction:column;padding-inline-start:var(--mb-space-3,0.75rem)}`,
  ],
  mega: (x) => [
    `${x}{position:relative}`,
    `${x} .mb-menu-l0{display:flex;flex-wrap:wrap;align-items:center}`,
    `${x} .mb-menu-l1{display:none;position:absolute;top:100%;left:0;right:0;z-index:50;grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))}`,
    `${x} .mb-menu-item:hover>.mb-menu-l1,${x} .mb-menu-item:focus-within>.mb-menu-l1,${x} .mb-menu-item[data-open]>.mb-menu-l1{display:grid}`,
    `${x} .mb-menu-l2{display:flex;flex-direction:column}`,
  ],
  columns: (x) => [
    `${x} .mb-menu-l0{display:grid;grid-template-columns:repeat(auto-fit,minmax(10rem,1fr));gap:var(--mb-space-8,2rem)}`,
    `${x} .mb-menu-l1{display:flex;flex-direction:column;margin-top:var(--mb-space-2,0.5rem)}`,
    `${x} .mb-menu-l2{display:none}`,
  ],
};

function menuCss(key: string, data: unknown, sheet: Sheet, context: StyleCompileContext): void {
  if (!isRecord(data)) return;
  const menu = data as unknown as MenuDesign;
  const x = `.${menuClass(key)}`;
  const { list, item, link, toggle, panel } = MENU_CLASSES;
  sheet.add('main', `${x} .${list}{list-style:none;margin:0;padding:0}`);
  sheet.add('main', `${x} .${link}{display:block}`);
  sheet.add('main', `${x} .${toggle}{display:none}`);
  const preset = PRESET_CSS[menu.preset] ?? PRESET_CSS.list;
  for (const css of preset(x)) sheet.add('main', css);
  const depth = Number.isInteger(menu.depth) ? Math.min(Math.max(menu.depth, 1), 3) : 3;
  if (depth < 3) sheet.add('main', `${x} .${menuLevelClass(depth)}{display:none}`);

  sheet.rules(x, menu.root, context);
  const levels = Array.isArray(menu.levels) ? menu.levels.slice(0, 3) : [];
  levels.forEach((level, index) => {
    if (!isRecord(level)) return;
    const listSelector = `${x} .${menuLevelClass(index)}`;
    const itemSelector = `${listSelector}>.${item}`;
    const linkSelector = `${itemSelector}>.${link}`;
    sheet.rules(listSelector, level.list, context);
    sheet.rules(itemSelector, level.item, context);
    sheet.rules(linkSelector, level.link, context);
    sheet.props(`${linkSelector}[aria-current]`, level.current, context);
  });

  const mobile = isRecord(menu.mobile) ? menu.mobile : null;
  if (!mobile || (mobile.behaviour !== 'burger' && mobile.behaviour !== 'offcanvas')) return;
  const inner = new Sheet();
  inner.add(
    'main',
    `${x} .${toggle}{display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font:inherit;background:none;border:0;color:inherit;padding:var(--mb-space-2,0.5rem)}`,
  );
  inner.add('main', `${x} .${menuLevelClass(0)}{flex-direction:column;align-items:stretch}`);
  inner.add(
    'main',
    `${x} :is(.${menuLevelClass(1)},.${menuLevelClass(2)}){position:static;display:flex;flex-direction:column;box-shadow:none}`,
  );
  if (mobile.behaviour === 'burger') {
    inner.add('main', `${x} .${panel}{display:none}`);
    inner.add('main', `${x}[data-open] .${panel}{display:block}`);
  } else {
    inner.add(
      'main',
      `${x} .${panel}{position:fixed;top:0;bottom:0;left:0;z-index:100;width:min(20rem,85vw);overflow-y:auto;transform:translateX(-100%);visibility:hidden;transition:transform 0.2s ease,visibility 0.2s;background:var(--mb-color-bg)}`,
    );
    inner.add('main', `${x}[data-open] .${panel}{transform:none;visibility:visible}`);
  }
  inner.rules(`${x} .${toggle}`, mobile.toggle, context);
  inner.rules(`${x} .${panel}`, mobile.panel, context);
  const query = mobile.breakpoint === 'mobile' ? MOBILE : TABLET;
  sheet.add('main', `${query}{\n${inner.toString()}\n}`);
}

function instanceCss(styles: SiteCssInput['instanceStyles'], context: StyleCompileContext): string {
  const byClass = new Map<string, InstanceStyle>();
  for (const style of styles ?? []) {
    const normalized = normalizeInstanceStyle(style);
    const name = instanceClass(normalized);
    if (normalized && name) byClass.set(name, normalized);
  }
  const sheet = new Sheet();
  for (const name of [...byClass.keys()].sort()) {
    const style = byClass.get(name) as InstanceStyle;
    const { background, backgroundImage, paddingX, paddingY, gap, textAlign } = style;
    const props: StyleProps = {};
    if (background) props.background = background;
    if (backgroundImage) props.backgroundImage = backgroundImage;
    if (paddingX) props.paddingX = paddingX;
    if (paddingY) props.paddingY = paddingY;
    if (gap) props.gap = gap;
    if (textAlign && ['left', 'center', 'right'].includes(textAlign)) props.textAlign = textAlign;
    const declarations = styleDeclarations(props, context);
    if (style.width === 'full') declarations.push(['width', '100%'], ['max-width', 'none']);
    if (style.width === 'contained')
      declarations.push(['max-width', 'var(--mb-container-default)'], ['margin-inline', 'auto']);
    sheet.add('main', rule(`.${name}`, declarations));
    const hide = Array.isArray(style.hide) ? style.hide : [];
    if (hide.includes('desktop'))
      sheet.add(
        'main',
        `@media (min-width:${SITE_BREAKPOINT_MAX.tablet + 1}px){.${name}{display:none}}`,
      );
    if (hide.includes('tablet'))
      sheet.add(
        'main',
        `@media (min-width:${SITE_BREAKPOINT_MAX.mobile + 1}px) and (max-width:${SITE_BREAKPOINT_MAX.tablet}px){.${name}{display:none}}`,
      );
    if (hide.includes('mobile')) sheet.add('main', `${MOBILE}{.${name}{display:none}}`);
  }
  return sheet.toString();
}

/**
 * The stylesheet of a site: font faces, then cascade layers for the reset, the theme, the
 * designs, block instance overrides and custom CSS. The same input gives the same output.
 */
export function compileSiteCss(input: SiteCssInput): string {
  const context: StyleCompileContext = { assetUrl: input.assetUrl };
  const designs = [...(input.designs ?? [])]
    .filter((design) => DESIGN_ORDER.includes(design.kind) && typeof design.key === 'string')
    .sort(
      (a, b) =>
        DESIGN_ORDER.indexOf(a.kind) - DESIGN_ORDER.indexOf(b.kind) ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );
  const designSheet = new Sheet();
  for (const design of designs) {
    if (design.kind === 'menu') menuCss(design.key, design.data, designSheet, context);
    else designCss(design, designSheet, context);
  }

  const customCss = typeof input.customCss === 'string' ? input.customCss.trim() : '';
  const custom =
    customCss && cssBracesBalanced(customCss) && !/<\/style/i.test(customCss) ? customCss : '';

  return [
    `@layer ${SITE_CSS_LAYERS.join(',')};`,
    fontFaces(input.theme, input.fontUrl),
    layer('mb-reset', resetCss()),
    layer('mb-theme', themeCss(input.theme, context)),
    layer('mb-design', designSheet.toString()),
    layer('mb-instance', instanceCss(input.instanceStyles, context)),
    layer('mb-custom', custom),
  ]
    .filter(Boolean)
    .join('\n');
}
