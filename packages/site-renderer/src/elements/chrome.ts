import {
  type ChromeElement,
  type DesignNode,
  generateMenuDesign,
  MENU_CLASSES,
  type MenuDesign,
  menuClass,
  menuLevelClass,
  type SiteMenu,
  type SiteMenuItem,
  SR_ONLY_CLASS,
} from '@manablox/site';
import { h, type VNodeChild } from 'vue';
import { nodeRef, type RenderContext } from '../context.js';
import { ICONS } from '../icons.js';
import type { ElementRenderer } from '../renderer.js';
import { type Crumb, ISLAND_ATTRIBUTE, NODE_ATTRIBUTE } from '../types.js';
import { pathOf, safeHref, smallHash } from '../util.js';
import { asAsset } from '../values.js';
import { empty, relFor, text } from './shared.js';

/** The locale's home: `/` or the locale prefix the current page sits under. */
function homeUrl(ctx: RenderContext): string {
  const { locale, input } = ctx;
  const path = pathOf(input.url) ?? '/';
  if (
    locale !== input.space?.defaultLocale &&
    (path === `/${locale}` || path.startsWith(`/${locale}/`))
  )
    return `/${locale}`;
  return '/';
}

const slot: ElementRenderer = ({ frame, ctx, attrs }) => {
  const body = frame.slot?.();
  if (body === undefined || body === null) return empty(ctx, attrs, 'main', 'Page content');
  return h('main', { ...attrs, id: 'main' }, [body]);
};

/** `page` for the shown page's link, `true` for its ancestors. */
function currentOf(item: SiteMenuItem, ctx: RenderContext): 'page' | 'true' | undefined {
  const here = pathOf(ctx.input.url);
  if (item.url && here && pathOf(item.url) === here) return 'page';
  return item.current ? 'true' : undefined;
}

function menuItems(
  items: SiteMenuItem[],
  level: number,
  depth: number,
  ctx: RenderContext,
): VNodeChild {
  if (level >= depth || items.length === 0) return null;
  return h(
    'ul',
    { class: [MENU_CLASSES.list, menuLevelClass(level)] },
    items.map((item) => {
      const current = currentOf(item, ctx);
      const href = safeHref(item.url);
      const label = item.label || item.url || '';
      const link = href
        ? h(
            'a',
            {
              class: MENU_CLASSES.link,
              href,
              target: item.target === '_blank' ? '_blank' : undefined,
              rel: relFor(item.target),
              'aria-current': current,
            },
            label,
          )
        : h('span', { class: MENU_CLASSES.link, 'aria-current': current }, label);
      return h(
        'li',
        { class: MENU_CLASSES.item, 'data-current': current ? '' : undefined },
        [link, menuItems(item.children ?? [], level + 1, depth, ctx)].filter(Boolean),
      );
    }),
  );
}

/** A menu's markup with a menu design; see `MENU_CLASSES`. */
export function renderMenu(
  menu: SiteMenu | null,
  design: MenuDesign,
  designKey: string,
  attrs: Record<string, unknown> & { class: unknown[] },
  ctx: RenderContext,
  idSeed: string,
): VNodeChild {
  const depth = Number.isInteger(design.depth) ? Math.min(Math.max(design.depth, 1), 3) : 3;
  const behaviour = design.mobile?.behaviour ?? 'none';
  const collapses = behaviour === 'burger' || behaviour === 'offcanvas';
  const panelId = `mb-menu-${smallHash(idSeed)}`;
  const label = text(ctx, design.mobile?.label) || 'Menu';
  const items = menu?.items ?? [];
  if (!ctx.canvas) ctx.islands.add('menu');
  return h(
    'nav',
    {
      ...attrs,
      class: [...attrs.class, MENU_CLASSES.root, menuClass(designKey)],
      'aria-label': menu?.name || label,
      [ISLAND_ATTRIBUTE]: 'menu',
      'data-mb-preset': design.preset,
      'data-mb-mobile': behaviour,
    },
    [
      collapses
        ? h(
            'button',
            {
              class: MENU_CLASSES.toggle,
              type: 'button',
              'aria-expanded': 'false',
              'aria-controls': panelId,
            },
            [
              h('svg', {
                viewBox: '0 0 24 24',
                width: '24',
                height: '24',
                fill: 'none',
                stroke: 'currentColor',
                'stroke-width': '2',
                'stroke-linecap': 'round',
                'aria-hidden': 'true',
                focusable: 'false',
                innerHTML: ICONS.menu,
              }),
              h('span', { class: SR_ONLY_CLASS }, label),
            ],
          )
        : null,
      h('div', { class: MENU_CLASSES.panel, id: panelId }, [menuItems(items, 0, depth, ctx)]),
    ],
  );
}

/** The menu design a `menu` element renders with: its `design` prop, else the menu's name. */
export function menuDesignKeyOf(node: DesignNode): string {
  const name = typeof node.props?.menu === 'string' ? node.props.menu : '';
  return typeof node.props?.design === 'string' && node.props.design ? node.props.design : name;
}

const menu: ElementRenderer = ({ node, frame, ctx, attrs }) => {
  const name = typeof node.props?.menu === 'string' ? node.props.menu : '';
  const designKey = menuDesignKeyOf(node);
  // The menu designer shows its design in place, with the entries it picked.
  const focus = ctx.canvas && ctx.options.focus?.kind === 'menu' ? ctx.options.focus : null;
  const focused = focus?.key === designKey;
  const shown = focused && focus?.menu ? focus.menu : name;
  const data = ctx.input.menus?.[shown] ?? ctx.input.menus?.[name] ?? null;
  if (!data && !ctx.canvas) return null;
  const design =
    ctx.input.menuDesigns?.[designKey] ?? generateMenuDesign({ machineName: name || 'main' });
  const marked = focused ? { ...attrs, [NODE_ATTRIBUTE]: `menu:${designKey}:root` } : attrs;
  return renderMenu(data, design, designKey, marked, ctx, nodeRef(frame, node));
};

const logo: ElementRenderer = ({ node, ctx, attrs }) => {
  const { site, space } = ctx.input;
  const name = site?.name || space?.name || '';
  const asset = site?.logo ? asAsset(site.logo.assetId, ctx) : null;
  const content = asset
    ? h('img', {
        src: asset.url,
        alt: text(ctx, site?.logo?.alt) || asset.alt || name,
        width: asset.width ?? undefined,
        height: asset.height ?? undefined,
        decoding: 'async',
      })
    : h('span', name);
  if (!asset && !name) return empty(ctx, attrs, 'div', 'Logo');
  if (node.props?.link === false) return h('div', attrs, [content]);
  return h('a', { ...attrs, href: homeUrl(ctx) }, [content]);
};

/** The current menu path: the first menu whose items lead to the shown page. */
function menuTrail(ctx: RenderContext): Crumb[] {
  for (const menuData of Object.values(ctx.input.menus ?? {})) {
    const trail: Crumb[] = [];
    let items = menuData.items ?? [];
    for (;;) {
      const current = items.find((item) => item.current || currentOf(item, ctx) === 'page');
      if (!current) break;
      trail.push({ label: current.label, url: current.url });
      items = current.children ?? [];
    }
    if (trail.length) return trail;
  }
  return [];
}

const breadcrumbs: ElementRenderer = ({ node, ctx, attrs }) => {
  const here = pathOf(ctx.input.url);
  const home = homeUrl(ctx);
  const title = ctx.input.document?.title ?? '';
  const trail = (ctx.options.breadcrumbs ?? menuTrail(ctx)).filter(
    (crumb) => crumb.label && pathOf(crumb.url) !== here && pathOf(crumb.url) !== home,
  );
  const crumbs: Crumb[] = [
    { label: ctx.input.site?.name || ctx.input.space?.name || 'Home', url: home },
    ...trail,
  ];
  const atHome = here === home;
  if (atHome && !ctx.canvas) return null;
  return h('nav', { ...attrs, 'aria-label': text(ctx, node.props?.label) || 'Breadcrumb' }, [
    h('ol', [
      ...crumbs.map((crumb) =>
        h('li', [
          safeHref(crumb.url)
            ? h('a', { href: safeHref(crumb.url) }, crumb.label)
            : h('span', crumb.label),
        ]),
      ),
      atHome ? null : h('li', [h('span', { 'aria-current': 'page' }, title)]),
    ]),
  ]);
};

function localeName(code: string, display: unknown): string {
  if (display === 'code') return code.toUpperCase();
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    return name ? name.charAt(0).toLocaleUpperCase(code) + name.slice(1) : code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

const localeSwitch: ElementRenderer = ({ node, ctx, attrs }) => {
  const alternates = ctx.input.alternates ?? [];
  if (alternates.length < 2 && !ctx.canvas) return null;
  const entries = alternates.length ? alternates : [{ locale: ctx.locale, url: ctx.input.url }];
  return h('nav', { ...attrs, 'aria-label': text(ctx, node.props?.label) || 'Language' }, [
    h(
      'ul',
      entries.map((entry) => {
        const current = entry.locale === ctx.locale;
        return h('li', [
          h(
            'a',
            {
              href: safeHref(entry.url) ?? undefined,
              hreflang: entry.locale,
              lang: entry.locale,
              'aria-current': current ? 'true' : undefined,
            },
            localeName(entry.locale, node.props?.display),
          ),
        ]);
      }),
    ),
  ]);
};

const searchLink: ElementRenderer = ({ node, ctx, attrs }) => {
  const href = safeHref(node.props?.href);
  const label = text(ctx, node.props?.text) || 'Search';
  if (!href) return empty(ctx, attrs, 'a', 'Search');
  return h('a', { ...attrs, href }, label);
};

export const chromeElements: Record<ChromeElement, ElementRenderer> = {
  slot,
  menu,
  logo,
  breadcrumbs,
  localeSwitch,
  searchLink,
};
