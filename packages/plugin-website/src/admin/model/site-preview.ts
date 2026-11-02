import type { ContentTypeDefinition } from '@manablox/core';
import {
  type BlockDesign,
  type DesignNode,
  defaultSiteSettings,
  generateLayout,
  generateMenuDesign,
  type LayoutDesign,
  type MenuDesign,
  type PageDesign,
  type SiteAsset,
  type SiteCssDesign,
  type SiteDocument,
  type SiteMenu,
  type SiteRenderInput,
  type SiteSettingsDesign,
  type ThemeDesign,
  walkNodes,
} from '@manablox/site';
import { blockDesignOf } from './block-style';
import type { ContentCanvas } from './site-canvas';

/** A stored design row with both copies. */
interface PreviewRow {
  kind: string;
  key: string;
  draft: unknown;
  published: unknown;
}

export interface DesignPreviewSource {
  space: { id: string; name: string; defaultLocale: string; locales: string[] };
  locale: string;
  types: readonly ContentTypeDefinition[];
  /** Stored designs; their drafts are shown, since a designer previews unpublished work. */
  rows: readonly PreviewRow[];
  /** Every menu of the space, resolved in `locale`, by machine name. */
  menus: Record<string, SiteMenu>;
  assets: Record<string, SiteAsset>;
  theme: ThemeDesign;
  /** The page in the layout's slot. */
  page: { key: string; design: PageDesign };
  /** The design being edited replaces its stored copy. */
  layout?: { key: string; design: LayoutDesign } | undefined;
  menuDesign?: { key: string; design: MenuDesign } | undefined;
  /** A menu shown although no element places it, for the menu designer. */
  extraMenu?: string | undefined;
  document: SiteDocument | null;
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

/** The layout key a page renders in: its own choice, else the site's assignment, else `default`. */
export function layoutKeyFor(
  page: PageDesign | null | undefined,
  site: Pick<SiteSettingsDesign, 'layouts'> | null | undefined,
  typeId: string,
): string {
  return page?.layout ?? site?.layouts?.[typeId] ?? 'default';
}

/**
 * The render input of a designer's canvas: the drafts of every stored design, the edited
 * design in place of its stored copy, generated designs for the rest, as the site builds them.
 */
export function designPreview(source: DesignPreviewSource): ContentCanvas {
  const stored = new Map<string, unknown>();
  for (const row of source.rows) {
    const data = row.draft ?? row.published;
    if (data !== null && data !== undefined) stored.set(`${row.kind}:${row.key}`, data);
  }
  const pick = <T>(kind: string, key: string): T | undefined =>
    stored.get(`${kind}:${key}`) as T | undefined;

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

  const page = source.page.design;
  const menuRefs = Object.values(source.menus).map((menu) => ({
    machineName: menu.machineName,
    name: menu.name,
  }));
  let layoutKey: string;
  let layout: LayoutDesign;
  if (source.layout) {
    layoutKey = source.layout.key;
    layout = source.layout.design;
  } else {
    const wanted = layoutKeyFor(page, site, source.page.key);
    const found = pick<LayoutDesign>('layout', wanted);
    layoutKey = found ? wanted : 'default';
    layout =
      found ?? pick<LayoutDesign>('layout', 'default') ?? generateLayout(source.space, menuRefs);
  }

  const menuDesigns: Record<string, MenuDesign> = {};
  for (const [id, data] of stored)
    if (id.startsWith('menu:')) menuDesigns[id.slice('menu:'.length)] = data as MenuDesign;
  for (const menu of menuRefs) menuDesigns[menu.machineName] ??= generateMenuDesign(menu);
  if (source.menuDesign) menuDesigns[source.menuDesign.key] = source.menuDesign.design;
  const placed = [...menuNodes(layout.root), ...menuNodes(page.root)];
  for (const node of placed) {
    const key = menuDesignKey(node);
    if (key && !menuDesigns[key])
      menuDesigns[key] = generateMenuDesign({ machineName: String(node.props?.menu ?? key) });
  }
  const menus: Record<string, SiteMenu> = {};
  const names = placed.map((node) => node.props?.menu);
  if (source.extraMenu) names.push(source.extraMenu);
  for (const name of names)
    if (typeof name === 'string' && source.menus[name]) menus[name] = source.menus[name];

  const input: SiteRenderInput = {
    mode: 'canvas',
    space: source.space,
    locale: source.locale,
    url: source.document?.permalink ?? '/',
    alternates: [],
    document: source.document,
    status: 200,
    contentTypes: Object.fromEntries(source.types.map((type) => [type.id, type])),
    page: source.page,
    layout: { key: layoutKey, design: layout },
    blockDesigns: blocks,
    menuDesigns,
    menus,
    theme: source.theme,
    site: { ...site, name: site.name || source.space.name },
    assets: source.assets,
    cssHref: '',
    formActionBase: '',
  };
  const designs: SiteCssDesign[] = [
    ...Object.entries(blocks).map(([key, data]) => ({ kind: 'block' as const, key, data })),
    { kind: 'page', key: source.page.key, data: page },
    { kind: 'layout', key: layoutKey, data: layout },
    ...Object.entries(menuDesigns).map(([key, data]) => ({ kind: 'menu' as const, key, data })),
  ];
  return { input, designs, customCss: site.customCss ?? null };
}

/** The page a layout shows in its slot on the canvas: the title and two paragraphs. */
export function samplePage(locale: string): PageDesign {
  const text = (value: string) => ({ [locale]: value });
  return {
    root: {
      id: 'root',
      el: 'section',
      style: { base: { paddingY: 'space:12' } },
      children: [
        {
          id: 'content',
          el: 'stack',
          style: { base: { gap: 'space:4' } },
          children: [
            { id: 'title', el: 'heading', bind: { field: '$title' }, props: { level: 1 } },
            {
              id: 'p1',
              el: 'text',
              props: {
                text: text(
                  'This is where each page goes. The layout around it stays the same on every page that uses it.',
                ),
              },
            },
            {
              id: 'p2',
              el: 'text',
              style: { base: { color: 'color:muted' } },
              props: { text: text('Lorem ipsum dolor sit amet, consectetur adipiscing elit.') },
            },
          ],
        },
      ],
    },
  };
}

/** A stand-in document for layout and menu previews. */
export function sampleDocument(typeId: string, fields: Record<string, unknown> = {}): SiteDocument {
  return {
    id: 'sample',
    localizationId: 'sample',
    typeId,
    title: 'Sample page',
    permalink: '/sample-page',
    publishedAt: '2026-03-14T10:30:00.000Z',
    author: 'Alex Morgan',
    fields,
  };
}
