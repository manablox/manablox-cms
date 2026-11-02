import type { BlockBreakpoint, ContentTypeDefinition, MenuItemTarget } from '@manablox/core';
import type { BlockInstanceStyle } from './block-design.js';

// Design documents

export const SITE_DESIGN_KINDS = ['theme', 'block', 'page', 'layout', 'menu', 'site'] as const;

export type SiteDesignKind = (typeof SITE_DESIGN_KINDS)[number];

/** `desktop` is the base; `tablet` and `mobile` match the block grid's breakpoints. */
export type Breakpoint = BlockBreakpoint;

export type StyleState = 'hover' | 'focus' | 'active';

/** Static text per locale code, e.g. `{ en: 'Read more', de: 'Weiterlesen' }`. */
export type LocalizedText = Record<string, string>;

// Element tree

export type StructureElement = 'box' | 'stack' | 'grid' | 'section' | 'spacer' | 'divider';
export type ContentElement =
  | 'text'
  | 'heading'
  | 'richtext'
  | 'image'
  | 'video'
  | 'icon'
  | 'link'
  | 'button'
  | 'embed';
export type DataElement = 'repeat' | 'blocks' | 'block' | 'template';
export type FormElement = 'form' | 'formField' | 'formSubmit' | 'formMessage';
/** Only allowed in layouts. */
export type ChromeElement =
  | 'slot'
  | 'menu'
  | 'logo'
  | 'breadcrumbs'
  | 'localeSwitch'
  | 'searchLink';

export type ElementKind =
  | StructureElement
  | ContentElement
  | DataElement
  | FormElement
  | ChromeElement;

/** How a bound value is turned into text. */
export type BindingFormat =
  | { type: 'date'; style?: 'short' | 'medium' | 'long'; time?: boolean }
  | {
      type: 'number';
      decimals?: number;
      style?: 'decimal' | 'percent' | 'currency';
      currency?: string;
      /** `false` drops the thousands separator, e.g. for years. */
      grouping?: boolean;
    }
  | { type: 'boolean'; trueText?: LocalizedText; falseText?: LocalizedText }
  | { type: 'list'; separator?: string }
  | { type: 'excerpt'; length?: number };

/** Document meta, available in page designs and layouts. */
export type DocumentMetaBinding = '$title' | '$permalink' | '$publishedAt' | '$author';
/** Site meta, available in layouts. */
export type SiteMetaBinding = '$site.name' | '$site.logo';

/**
 * Where an element's content comes from. `field` is a field id, a dotted path into a
 * repeater (`<fieldId>.<subFieldId>`), `<fieldId>.$item` for the current entry of a list
 * inside a `repeat`, or a meta binding starting with `$`.
 */
export interface Binding {
  field: string;
  format?: BindingFormat;
}

export interface NodeVisibility {
  /** Shown only at these breakpoints; absent means everywhere. */
  breakpoints?: Breakpoint[];
  /** Hidden when this bound field is empty. */
  whenField?: string;
}

export interface DesignNode {
  /** Stable within its design; part of the CSS class. */
  id: string;
  el: ElementKind;
  bind?: Binding;
  /** Element options; text props hold `LocalizedText`. */
  props?: Record<string, unknown>;
  style?: StyleRules;
  children?: DesignNode[];
  visibility?: NodeVisibility;
}

// Styling

/**
 * Token references are `<group>:<name>`, e.g. `color:primary`, `space:4`, `radius:md`.
 * Colors take an optional opacity percentage: `color:primary/50`.
 */
export type TokenGroup = 'color' | 'space' | 'radius' | 'shadow' | 'type' | 'font' | 'container';
export type TokenRef = `${TokenGroup}:${string}`;
export type ColorRef = `color:${string}`;
export type SpaceRef = `space:${string}`;

/** A number with a unit: `px`, `rem`, `em`, `%`, `vw`, `vh`, `svh`, `dvh` or `ch`. */
export type SizeValue = string;

export type AlignValue = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
export type JustifyValue = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';

export interface BackgroundImage {
  assetId: string;
  position?: 'center' | 'top' | 'bottom' | 'left' | 'right';
  size?: 'cover' | 'contain' | 'auto';
  repeat?: boolean;
}

export interface BackgroundGradient {
  from: ColorRef;
  to: ColorRef;
  via?: ColorRef;
  /** Degrees. */
  angle?: number;
}

/** The style allow-list. Spacing, colors, radius, shadows and type are token references only. */
export interface StyleProps {
  padding?: SpaceRef | '0';
  paddingX?: SpaceRef | '0';
  paddingY?: SpaceRef | '0';
  paddingTop?: SpaceRef | '0';
  paddingRight?: SpaceRef | '0';
  paddingBottom?: SpaceRef | '0';
  paddingLeft?: SpaceRef | '0';
  margin?: SpaceRef | '0' | 'auto';
  marginX?: SpaceRef | '0' | 'auto';
  marginY?: SpaceRef | '0' | 'auto';
  marginTop?: SpaceRef | '0' | 'auto';
  marginRight?: SpaceRef | '0' | 'auto';
  marginBottom?: SpaceRef | '0' | 'auto';
  marginLeft?: SpaceRef | '0' | 'auto';
  gap?: SpaceRef | '0';

  width?: SizeValue | 'auto' | `container:${string}`;
  maxWidth?: SizeValue | 'none' | `container:${string}`;
  minWidth?: SizeValue;
  height?: SizeValue | 'auto';
  minHeight?: SizeValue;
  maxHeight?: SizeValue | 'none';
  aspectRatio?: '1/1' | '4/3' | '3/2' | '16/9' | '21/9' | '3/4' | '2/3' | '9/16' | 'auto';

  display?: 'block' | 'flex' | 'grid' | 'inline-flex';
  direction?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  wrap?: boolean;
  align?: AlignValue;
  justify?: JustifyValue;
  alignSelf?: AlignValue | 'auto';
  grow?: boolean;
  /** Grid columns, 1 to 12. */
  columns?: number;

  type?: `type:${string}`;
  font?: `font:${string}`;
  fontWeight?: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
  fontStyle?: 'normal' | 'italic';
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  textDecoration?: 'none' | 'underline' | 'line-through';

  color?: ColorRef;
  background?: ColorRef;
  backgroundImage?: BackgroundImage;
  backgroundGradient?: BackgroundGradient;

  borderWidth?: SizeValue | '0';
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'none';
  borderColor?: ColorRef;
  radius?: `radius:${string}` | '0';
  shadow?: `shadow:${string}` | 'none';

  /** 0 to 1. */
  opacity?: number;
  overflow?: 'visible' | 'hidden' | 'auto' | 'clip';
  objectFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
  objectPosition?: 'center' | 'top' | 'bottom' | 'left' | 'right';
}

export type StylePropName = keyof StyleProps;

/** `base` is desktop; `tablet` and `mobile` override it below 1024px and 640px. */
export interface StyleRules {
  base?: StyleProps;
  tablet?: StyleProps;
  mobile?: StyleProps;
  hover?: StyleProps;
  focus?: StyleProps;
  active?: StyleProps;
}

// Theme

export const COLOR_ROLES = [
  'bg',
  'surface',
  'text',
  'muted',
  'primary',
  'onPrimary',
  'border',
  'accent',
] as const;

export type ColorRole = (typeof COLOR_ROLES)[number];

/** A CSS color (`#hex`, `rgb()`, `hsl()`, `oklch()`, ...) or the name of a palette entry. */
export type ColorValue = string;

export interface ThemeColors {
  palette: Record<string, ColorValue>;
  roles: Record<ColorRole, ColorValue>;
  /** Roles for `prefers-color-scheme: dark`; missing roles keep the light value. */
  dark?: Partial<Record<ColorRole, ColorValue>>;
}

export interface FontFile {
  /** `asset` and `google` families: the uploaded or downloaded woff2 asset. */
  assetId?: string;
  /** `bundled` families: path below the renderer's font folder. */
  bundledPath?: string;
  /** A weight, or a range like `'100 900'` for variable fonts. */
  weight: number | string;
  style: 'normal' | 'italic';
}

export interface FontFamily {
  /** Referenced as `font:<id>`. */
  id: string;
  /** The CSS family name. */
  name: string;
  source: 'bundled' | 'asset' | 'google';
  files: FontFile[];
  /** Fallback stack, e.g. `system-ui, sans-serif`. */
  fallback: string;
}

export type FontRole = 'body' | 'heading' | 'mono';

export interface ThemeFonts {
  families: FontFamily[];
  /** Family id per role; referenced as `font:body`, `font:heading`, `font:mono`. */
  roles: Record<FontRole, string>;
}

export const TYPE_STEPS = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl'] as const;

export type TypeStep = (typeof TYPE_STEPS)[number];

export interface TypeScaleEntry {
  size: SizeValue;
  /** Size below 640px; defaults to `size`. */
  mobileSize?: SizeValue;
  lineHeight: number;
  weight: number;
  /** e.g. `-0.01em`. */
  letterSpacing?: SizeValue;
}

export type HeadingLevel = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

export interface TextDefaults {
  type: TypeStep;
  font: FontRole;
  weight?: number;
  color?: ColorRef;
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
}

export interface ThemeContainer {
  widths: Record<string, SizeValue>;
  /** Width a `section` uses unless it names one. */
  default: string;
  /** Inline padding of a container. */
  gutter: SpaceRef;
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

/** Base styles for plain elements, applied before any design. */
export interface ThemeElements {
  body?: StyleRules;
  link?: StyleRules;
  button?: StyleRules;
  buttons?: Partial<Record<ButtonVariant, StyleRules>>;
  input?: StyleRules;
  label?: StyleRules;
  /** The richtext container. */
  prose?: StyleRules;
}

export interface ThemeTokens {
  colors: ThemeColors;
  fonts: ThemeFonts;
  type: Record<TypeStep, TypeScaleEntry>;
  headings: Record<HeadingLevel, TextDefaults>;
  body: TextDefaults;
  space: Record<string, SizeValue>;
  radius: Record<string, SizeValue>;
  shadow: Record<string, string>;
  container: ThemeContainer;
}

export interface ThemeDesign extends ThemeTokens {
  elements: ThemeElements;
}

// Block, page, layout

export interface BlockVariant {
  label: string;
  root: DesignNode;
}

export interface BlockDesign {
  variants: Record<string, BlockVariant>;
  /** Name of the variant a block renders with unless it picks one. */
  default: string;
}

/** Head tags of a page taken from the document's fields, by field id. */
export interface PageSeo {
  /** A string or richtext field for the meta description; the site's default otherwise. */
  description?: string;
  /** An asset field for the share image; the site's default otherwise. */
  image?: string;
}

export interface PageDesign {
  root: DesignNode;
  /** Layout key; absent means the site's assignment or `default`. */
  layout?: string;
  seo?: PageSeo;
}

/** Exactly one `slot` in `root` marks where the page goes. */
export interface LayoutDesign {
  root: DesignNode;
}

// Menus

export type MenuPreset = 'bar' | 'list' | 'dropdown' | 'mega' | 'columns';

export interface MenuLevelStyle {
  /** The `ul` of this level. */
  list?: StyleRules;
  /** Each `li`. */
  item?: StyleRules;
  /** Each link, with hover, focus and active states. */
  link?: StyleRules;
  /** The link of the page being shown and its ancestors. */
  current?: StyleProps;
}

export interface MenuMobile {
  /** `none` keeps the desktop menu; the others collapse it behind a toggle. */
  behaviour: 'none' | 'burger' | 'offcanvas';
  /** At and below this breakpoint the mobile behaviour applies. */
  breakpoint: 'tablet' | 'mobile';
  /** Toggle button label, for screen readers. */
  label?: LocalizedText;
  toggle?: StyleRules;
  panel?: StyleRules;
}

export interface MenuDesign {
  preset: MenuPreset;
  /** Levels shown, 1 to 3. */
  depth: number;
  root?: StyleRules;
  /** Index 0 is the top level. */
  levels: MenuLevelStyle[];
  mobile: MenuMobile;
}

// Site settings

export interface SiteSettingsDesign {
  name: string;
  logo?: { assetId: string; alt?: LocalizedText } | null;
  /** Asset id. */
  favicon?: string | null;
  /** `{title}` and `{site}` are replaced. */
  titlePattern: string;
  meta: {
    description?: LocalizedText;
    /** Asset id of the default share image. */
    ogImage?: string | null;
  };
  robots: {
    /** `false` adds `noindex` everywhere and disallows all crawlers. */
    index: boolean;
    /** Extra `robots.txt` lines. */
    extra?: string;
  };
  /** Needs `design:code`. */
  customCss?: string;
  /** HTML appended to `<head>`; needs `design:code`. */
  headCode?: string;
  /** HTML appended before `</body>`; needs `design:code`. */
  bodyEndCode?: string;
  /** Layout key per content type id; others use `default`. */
  layouts: Record<string, string>;
}

// Per-instance overrides

/** Stored on `BlockValue.ext.website.style`; styles the block's root only. */
export type InstanceStyle = BlockInstanceStyle;

export interface SiteDesignDataMap {
  theme: ThemeDesign;
  block: BlockDesign;
  page: PageDesign;
  layout: LayoutDesign;
  menu: MenuDesign;
  site: SiteSettingsDesign;
}

export type SiteDesignData<K extends SiteDesignKind = SiteDesignKind> = SiteDesignDataMap[K];

export interface SiteIssue {
  /** Dotted path into the design, e.g. `variants.default.root.children.0.style.base.gap`. */
  path: string;
  message: string;
}

export type SiteValidationResult<T> = { ok: true; value: T } | { ok: false; issues: SiteIssue[] };

// Render input

export interface SiteMenuItem {
  id: string;
  label: string;
  url: string | null;
  target: MenuItemTarget;
  /** The shown page is this item or below it. */
  current?: boolean;
  children: SiteMenuItem[];
}

export interface SiteMenu {
  id: string;
  name: string;
  machineName: string;
  items: SiteMenuItem[];
}

export interface SiteAsset {
  url: string;
  width?: number | null;
  height?: number | null;
  alt?: string | null;
  mimeType?: string | null;
}

/** The document being rendered, fields in delivery shape (keyed by field name). */
export interface SiteDocument {
  id: string;
  localizationId: string;
  typeId: string;
  title: string;
  permalink: string | null;
  publishedAt: string | null;
  author?: string | null;
  fields: Record<string, unknown>;
}

export interface SiteDesignRef<T> {
  key: string;
  design: T;
}

/** Everything one page render needs, already resolved. */
export interface SiteRenderInput {
  mode: 'live' | 'share' | 'canvas';
  space: { id: string; name: string; defaultLocale: string; locales: string[] };
  locale: string;
  /** Absolute canonical URL of this page. */
  url: string;
  alternates: Array<{ locale: string; url: string }>;
  /** `null` renders the generated not-found page. */
  document: SiteDocument | null;
  /** HTTP status the page is served with. */
  status: number;
  /** Content types by id, to map field ids to delivery names. */
  contentTypes: Record<string, ContentTypeDefinition>;
  page: SiteDesignRef<PageDesign>;
  layout: SiteDesignRef<LayoutDesign>;
  /** By block content type id. */
  blockDesigns: Record<string, BlockDesign>;
  /** By menu design key. */
  menuDesigns: Record<string, MenuDesign>;
  /** By menu machine name. */
  menus: Record<string, SiteMenu>;
  theme: ThemeDesign;
  site: SiteSettingsDesign;
  /** Assets the designs and site settings reference (logo, favicon, backgrounds), by id. */
  assets: Record<string, SiteAsset>;
  cssHref: string;
  /** Form posts go to `<formActionBase>/<designKind>/<designKey>/<nodeId>`. */
  formActionBase: string;
}
