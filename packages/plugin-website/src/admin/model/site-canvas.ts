import type { ContentTypeDefinition } from '@manablox/core';
import {
  type BlockDesign,
  type BlockInstanceStyle,
  compileSiteCss,
  type DesignNode,
  defaultSiteSettings,
  defaultTheme,
  type FontFamily,
  type FontFile,
  generateLayout,
  generateMenuDesign,
  generatePageDesign,
  type LayoutDesign,
  type MenuDesign,
  type MenuRef,
  type PageDesign,
  type SiteAsset,
  type SiteCssDesign,
  type SiteMenu,
  type SiteRenderInput,
  type SiteSettingsDesign,
  type ThemeDesign,
  walkNodes,
} from '@manablox/site';
import { blockDesignOf } from './block-style';
import { type CanvasAssets, mediaPath } from './canvas';

/** Which copy of the stored designs the canvas shows. */
export type CanvasDesignVariant = 'published' | 'draft';

/** A stored design row, as `design.get` returns it. */
interface StoredDesign {
  kind: string;
  key: string;
  draft: unknown;
  published: unknown;
}

export interface ContentCanvasSource {
  space: { id: string; name: string; defaultLocale: string; locales: string[] };
  locale: string;
  /** The space's content types, the page's own among them. */
  types: readonly ContentTypeDefinition[];
  pageTypeId: string;
  rows: readonly StoredDesign[];
  variant: CanvasDesignVariant;
  /** Every menu of the space, resolved in `locale`, by machine name. */
  menus: Record<string, SiteMenu>;
  assets: Record<string, SiteAsset>;
}

export interface ContentCanvas {
  /** Without a document; the editor adds the draft when it sends it. */
  input: SiteRenderInput;
  /** What the stylesheet compiles. */
  designs: SiteCssDesign[];
  customCss: string | null;
}

/**
 * The render input of a document's page on a designed site: stored designs of the variant
 * and generated ones for the rest, as the site process builds them.
 */
export function contentCanvasInput(source: ContentCanvasSource): ContentCanvas {
  const stored = new Map<string, unknown>();
  for (const row of source.rows) {
    const data = source.variant === 'draft' ? (row.draft ?? row.published) : row.published;
    if (data !== null && data !== undefined) stored.set(`${row.kind}:${row.key}`, data);
  }
  const pick = <T>(kind: string, key: string): T | undefined =>
    stored.get(`${kind}:${key}`) as T | undefined;

  const theme = pick<ThemeDesign>('theme', 'default') ?? defaultTheme();
  const site: SiteSettingsDesign = {
    ...defaultSiteSettings(),
    ...pick<SiteSettingsDesign>('site', 'default'),
  };

  const blocks: Record<string, BlockDesign> = {};
  for (const type of source.types) {
    if (type.isSystem || type.kind !== 'block') continue;
    const design = blockDesignOf(pick('block', type.id), type);
    if (design) blocks[type.id] = design;
  }
  const pageType = source.types.find((type) => type.id === source.pageTypeId) ?? null;
  const page: PageDesign =
    pick<PageDesign>('page', source.pageTypeId) ??
    (pageType ? generatePageDesign(pageType) : { root: { id: 'root', el: 'stack' } });

  const menuRefs: MenuRef[] = Object.values(source.menus).map((menu) => ({
    machineName: menu.machineName,
    name: menu.name,
  }));
  const layoutKey = page.layout ?? site.layouts?.[source.pageTypeId] ?? 'default';
  const storedLayout = pick<LayoutDesign>('layout', layoutKey);
  const layout =
    storedLayout ??
    pick<LayoutDesign>('layout', 'default') ??
    generateLayout(source.space, menuRefs);

  const menuDesigns: Record<string, MenuDesign> = {};
  for (const [id, data] of stored) {
    if (id.startsWith('menu:')) menuDesigns[id.slice('menu:'.length)] = data as MenuDesign;
  }
  for (const menu of menuRefs) menuDesigns[menu.machineName] ??= generateMenuDesign(menu);
  const placed = [...menuNodes(layout.root), ...menuNodes(page.root)];
  for (const node of placed) {
    const key = menuDesignKey(node);
    if (key && !menuDesigns[key])
      menuDesigns[key] = generateMenuDesign({ machineName: String(node.props?.menu ?? key) });
  }
  const menus: Record<string, SiteMenu> = {};
  for (const node of placed) {
    const name = node.props?.menu;
    if (typeof name === 'string' && source.menus[name]) menus[name] = source.menus[name];
  }

  const input: SiteRenderInput = {
    mode: 'canvas',
    space: source.space,
    locale: source.locale,
    url: '/',
    alternates: [],
    document: null,
    status: 200,
    contentTypes: Object.fromEntries(source.types.map((type) => [type.id, type])),
    page: { key: source.pageTypeId, design: page },
    layout: { key: storedLayout ? layoutKey : 'default', design: layout },
    blockDesigns: blocks,
    menuDesigns,
    menus,
    theme,
    site: { ...site, name: site.name || source.space.name },
    assets: source.assets,
    cssHref: '',
    formActionBase: '',
  };
  const designs: SiteCssDesign[] = [
    ...Object.entries(blocks).map(([key, data]) => ({ kind: 'block' as const, key, data })),
    { kind: 'page', key: source.pageTypeId, data: page },
    { kind: 'layout', key: input.layout.key, data: layout },
    ...Object.entries(menuDesigns).map(([key, data]) => ({ kind: 'menu' as const, key, data })),
  ];
  return { input, designs, customCss: site.customCss ?? null };
}

/**
 * The canvas stylesheet with the draft's block overrides. Bundled fonts come from the site
 * process, uploaded ones are inlined, images link the admin's media route.
 */
export function contentCanvasCss(
  canvas: ContentCanvas,
  instanceStyles: readonly BlockInstanceStyle[],
  assets: CanvasAssets,
): string {
  const fontUrl = (file: FontFile, family: FontFamily): string | null => {
    if (family.source === 'bundled')
      return file.bundledPath ? `/_site/fonts/${file.bundledPath}` : null;
    return file.assetId ? assets.fontData(file.assetId) : null;
  };
  return compileSiteCss({
    theme: canvas.input.theme,
    designs: canvas.designs,
    instanceStyles: [...instanceStyles],
    customCss: canvas.customCss,
    fontUrl,
    assetUrl: (assetId) => `${assets.mediaOrigin}${mediaPath(assetId)}`,
  });
}

/** `menu` elements of a tree. */
function menuNodes(root: DesignNode | undefined): DesignNode[] {
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
