import type { FontFamily, FontFile, InstanceStyle, SiteDesignKind } from '@manablox/site';

/** Client scripts, each served as its own file and loaded only when the page needs it. */
export const ISLAND_NAMES = ['menu', 'form'] as const;

export type IslandName = (typeof ISLAND_NAMES)[number];

/** Names the island that enhances an element. */
export const ISLAND_ATTRIBUTE = 'data-mb-island';
/** Canvas only: `<designKind>:<designKey>:<nodeId>` of the node an element renders. */
export const NODE_ATTRIBUTE = 'data-mb-node';
/** Canvas only: the element kind of a node. */
export const ELEMENT_ATTRIBUTE = 'data-mb-el';

/** What the canvas shows: a single design, or the page when absent. */
export interface DesignFocus {
  kind: SiteDesignKind;
  key: string;
  /** Block designs: the variant shown. */
  variant?: string;
  /** Menu designs: the menu (machine name) rendered with the design. */
  menu?: string;
}

export interface Crumb {
  label: string;
  url: string | null;
}

/** A form post result shown on the page after the no-JS redirect. */
export interface FormResult {
  /** `<designKind>:<designKey>:<nodeId>` of the form. */
  form: string;
  ok: boolean;
  /** Shown instead of the default error text. */
  message?: string | undefined;
  /** Messages by field name; the consent checkbox is `_mb_consent`. */
  errors?: Record<string, string> | undefined;
}

export interface RenderOptions {
  /** Script URL per island, e.g. `/_site/islands/menu.3f2a1c.js`; defaults to `/_site/islands/<name>.js`. */
  islandSrc?: Partial<Record<IslandName, string>>;
  /** Image preset widths for `srcset`, by preset name; presets missing on an asset are skipped. */
  imageWidths?: Record<string, number>;
  /** Font file URLs, as passed to `compileSiteCss`; used for preload links. */
  fontUrl?: (file: FontFile, family: FontFamily) => string | null;
  /** The trail for `breadcrumbs`, root first, without the page itself. Defaults to the current menu path. */
  breadcrumbs?: Crumb[];
  formResult?: FormResult;
  /**
   * Signs the databag type a bound form stores in, for `<designKind>:<designKey>:<nodeId>`;
   * without it such forms carry no type and their posts fail.
   */
  formToken?: (ref: string, databagTypeId: string) => string;
  /** Render time in ms, written into forms for the minimum fill time. */
  now?: number;
  /** Canvas: the design being edited. */
  focus?: DesignFocus;
  /** The "Made with" badge in the page tail; none without it. */
  badge?: SiteBadge | undefined;
}

/** Plain text and link of the site badge. */
export interface SiteBadge {
  text: string;
  link: string;
}

export interface SiteHead {
  title: string;
  description: string;
  /** Share image URL; the page design's image field, else the site's default. */
  image?: string | null;
}

export interface SiteRenderResult {
  html: string;
  status: number;
  head: SiteHead;
  /** Islands the page loads. */
  islands: IslandName[];
  /** Block instance overrides on the page; each needs its `instanceClass` rule in the stylesheet. */
  instanceStyles: InstanceStyle[];
}

/** A field as the renderer reads it: from a content type or a repeater's sub-fields. */
export interface FieldDef {
  id: string;
  name: string;
  type: string;
  label?: string | undefined;
  required?: boolean | undefined;
  settings?: Record<string, unknown> | undefined;
}

/** Path of a field for the live-preview markers: names and list indices. */
export type MarkerPath = (string | number)[];
