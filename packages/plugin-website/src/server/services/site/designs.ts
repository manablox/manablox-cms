import { createHash } from 'node:crypto';
import type { ContentTypeDefinition } from '@manablox/core';
import {
  type BlockDesign,
  compileSiteCss,
  type DesignNode,
  defaultSiteSettings,
  defaultTheme,
  type FontFamily,
  type FontFile,
  generateBlockDesign,
  generateLayout,
  generateMenuDesign,
  generatePageDesign,
  type LayoutDesign,
  type MenuDesign,
  type MenuRef,
  type PageDesign,
  type SiteCssDesign,
  type SiteCssInput,
  type SiteSettingsDesign,
  type ThemeDesign,
  walkNodes,
} from '@manablox/site';
import { WEBSITE } from '../../../shared/site.js';
import type { SiteDesignRow } from '../../db/index.js';

/** Which copy of the stored designs a site renders: live, or drafts for a share link. */
export type SiteDesignVariant = 'published' | 'draft';

/** Every design of a space, stored or generated, plus the stylesheet they compile to. */
export interface SiteDesignBundle {
  theme: ThemeDesign;
  site: SiteSettingsDesign;
  /** By content type id. */
  pages: Record<string, PageDesign>;
  /** By layout key; always holds `default`. */
  layouts: Record<string, LayoutDesign>;
  /** By block type id. */
  blocks: Record<string, BlockDesign>;
  /** By menu design key. */
  menus: Record<string, MenuDesign>;
  css: string;
  /** Content hash of `css`, used in its URL. */
  cssHash: string;
  /** What `css` was compiled from, to add block instance overrides to. */
  cssInput: SiteCssInput;
  /** Assets the designs reference (fonts, backgrounds, logo, favicon, share image). */
  assetIds: string[];
}

export interface SiteBundleSource {
  space: { name: string; defaultLocale: string };
  rows: readonly SiteDesignRow[];
  variant: SiteDesignVariant;
  /** The space's content types. */
  types: readonly ContentTypeDefinition[];
  menus: readonly MenuRef[];
}

/** URL of an asset used by a stylesheet. */
export const designAssetUrl = (assetId: string): string =>
  `/media/${encodeURIComponent(assetId)}/original`;

/** URL of a bundled font file. */
const bundledFontUrl = (path: string): string => `/_site/fonts/${path}`;

/** Stored designs of the variant, generated ones for everything else, and their CSS. */
export function buildDesignBundle(source: SiteBundleSource): SiteDesignBundle {
  const stored = new Map<string, unknown>();
  for (const row of source.rows) {
    const data = source.variant === 'draft' ? (row.draft ?? row.published) : row.published;
    if (data !== null && data !== undefined) stored.set(`${row.kind}:${row.key}`, data);
  }
  const pick = <T>(kind: string, key: string): T | undefined =>
    stored.get(`${kind}:${key}`) as T | undefined;

  const theme = pick<ThemeDesign>('theme', 'default') ?? defaultTheme();
  const site = { ...defaultSiteSettings(), ...pick<SiteSettingsDesign>('site', 'default') };

  const pages: Record<string, PageDesign> = {};
  const blocks: Record<string, BlockDesign> = {};
  for (const type of source.types) {
    if (type.isSystem) continue;
    if (type.kind === 'block')
      blocks[type.id] =
        pick<BlockDesign>('block', type.id) ??
        (type.plugins?.[WEBSITE] as BlockDesign | undefined) ??
        generateBlockDesign(type);
    if (type.kind === 'content')
      pages[type.id] = pick<PageDesign>('page', type.id) ?? generatePageDesign(type);
  }

  const layouts: Record<string, LayoutDesign> = {};
  const menus: Record<string, MenuDesign> = {};
  for (const [id, data] of stored) {
    const [kind, key] = splitId(id);
    if (kind === 'layout') layouts[key] = data as LayoutDesign;
    if (kind === 'menu') menus[key] = data as MenuDesign;
  }
  layouts.default ??= generateLayout(source.space, source.menus);
  for (const menu of source.menus) menus[menu.machineName] ??= generateMenuDesign(menu);
  // Menus placed with a design key nobody stored render with the default look.
  for (const root of [...Object.values(layouts), ...Object.values(pages)].map((d) => d.root)) {
    for (const node of menuNodes(root)) {
      const key = menuDesignKey(node);
      if (key && !menus[key])
        menus[key] = generateMenuDesign({ machineName: String(node.props?.menu ?? key) });
    }
  }

  const designs: SiteCssDesign[] = [
    ...Object.entries(blocks).map(([key, data]) => ({ kind: 'block' as const, key, data })),
    ...Object.entries(pages).map(([key, data]) => ({ kind: 'page' as const, key, data })),
    ...Object.entries(layouts).map(([key, data]) => ({ kind: 'layout' as const, key, data })),
    ...Object.entries(menus).map(([key, data]) => ({ kind: 'menu' as const, key, data })),
  ];
  const cssInput: SiteCssInput = {
    theme,
    designs,
    customCss: site.customCss ?? null,
    fontUrl: siteFontUrl,
    assetUrl: designAssetUrl,
  };
  const css = compileSiteCss(cssInput);

  return {
    theme,
    site,
    pages,
    layouts,
    blocks,
    menus,
    css,
    cssHash: cssHash(css),
    cssInput,
    assetIds: [...collectAssetIds([theme, site, ...designs.map((design) => design.data)])],
  };
}

/** Content hash of a stylesheet, as its URL names it. */
export function cssHash(css: string): string {
  return createHash('sha256').update(css).digest('base64url').slice(0, 16);
}

/** URL of a theme font file: its asset, or the bundled copy. */
export function siteFontUrl(file: FontFile, _family?: FontFamily): string | null {
  if (file.assetId) return designAssetUrl(file.assetId);
  if (file.bundledPath) return bundledFontUrl(file.bundledPath);
  return null;
}

function splitId(id: string): [string, string] {
  const colon = id.indexOf(':');
  return [id.slice(0, colon), id.slice(colon + 1)];
}

/** `menu` elements of a tree. */
export function menuNodes(root: DesignNode | undefined): DesignNode[] {
  if (!root) return [];
  const out: DesignNode[] = [];
  walkNodes(root, ({ node }) => {
    if (node.el === 'menu') out.push(node);
    return undefined;
  });
  return out;
}

/** The menu design a `menu` element renders with: its `design` prop, else the menu's name. */
function menuDesignKey(node: DesignNode): string | null {
  const design = node.props?.design;
  if (typeof design === 'string' && design) return design;
  const menu = node.props?.menu;
  return typeof menu === 'string' && menu ? menu : null;
}

/** Every `assetId` value, plus the site's favicon and share image. */
function collectAssetIds(values: unknown[]): Set<string> {
  const ids = new Set<string>();
  const walk = (value: unknown, depth: number): void => {
    if (depth > 64 || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, depth + 1);
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'assetId' && typeof entry === 'string' && entry) ids.add(entry);
      else walk(entry, depth + 1);
    }
  };
  for (const value of values) walk(value, 0);
  const site = values[1] as SiteSettingsDesign;
  if (site.favicon) ids.add(site.favicon);
  if (site.meta?.ogImage) ids.add(site.meta.ogImage);
  return ids;
}
