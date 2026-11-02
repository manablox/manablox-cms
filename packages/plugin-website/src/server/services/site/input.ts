import { trackTouched } from '@manablox/cache';
import type { ContentTypeDefinition } from '@manablox/core';
import type { AssetRow, ContentRow } from '@manablox/db';
import type { PublicMenuItem } from '@manablox/services';
import {
  type DesignNode,
  generatePageDesign,
  type PageDesign,
  type SiteAsset,
  type SiteMenu,
  type SiteMenuItem,
  type SiteRenderInput,
} from '@manablox/site';
import { type SiteContext, type SiteLoaderContext, type SiteRead, siteTypes } from './context.js';
import { designAssetUrl, menuNodes, type SiteDesignBundle } from './designs.js';
import { type SiteLocation, type SiteUrls, withSiteLinks } from './urls.js';

/** An empty page design, for the generated not-found page. */
const NOT_FOUND_PAGE: PageDesign = { root: { id: 'root', el: 'stack', children: [] } };

/** What `renderInput` assembles a page from. */
interface RenderInputArgs {
  context: SiteContext;
  read: SiteRead;
  urls: SiteUrls;
  bundle: SiteDesignBundle;
  doc: ContentRow | null;
  location: SiteLocation;
  status: number;
  mode: 'live' | 'share';
  /** Collects the cache tags of the menus the page shows. */
  menuTags: string[];
}

/** Everything the renderer needs for one page: designs, document, menus, links and assets. */
export async function renderInput(
  ctx: SiteLoaderContext,
  args: RenderInputArgs,
): Promise<SiteRenderInput> {
  const { context, read, urls, bundle, doc, location } = args;
  const { space, scope } = context;
  const types = siteTypes(ctx, scope);
  const type = doc ? ctx.options.manablox.contentTypes.tryGet(doc.typeId) : undefined;
  const { page, layout } = pageAndLayout(bundle, type);

  // Independent reads, so they run at once.
  const [menus, document, alternates, assets] = await Promise.all([
    siteMenus(read, urls, [layout.design.root, page.root], location.locale, doc, args.menuTags),
    doc ? documentInput(ctx, read, urls, doc, location.locale) : null,
    doc ? alternatesOf(ctx, args, doc) : [],
    designAssets(ctx, bundle, space.id),
  ]);

  const docPermalink = doc ? urls.permalinkOf(doc) : null;
  return {
    mode: args.mode,
    space: {
      id: space.id,
      name: space.name,
      defaultLocale: space.defaultLocale,
      locales: space.locales,
    },
    locale: location.locale,
    url: urls.absolute(location.locale, docPermalink ?? location.permalink),
    alternates: args.status === 200 ? alternates : [],
    document,
    status: args.status,
    contentTypes: Object.fromEntries(types.map((entry) => [entry.id, entry])),
    page: { key: type?.id ?? 'not-found', design: page },
    layout,
    blockDesigns: bundle.blocks,
    menuDesigns: bundle.menus,
    menus,
    theme: bundle.theme,
    site: {
      ...bundle.site,
      name: bundle.site.name || space.name,
      // Staging is never indexed.
      ...(scope.production ? {} : { robots: { ...bundle.site.robots, index: false } }),
    },
    assets,
    cssHref: `/_site/${bundle.cssHash}.css`,
    formActionBase: '/_manablox/forms',
  };
}

/** The page design of a document's type (generated when not stored) and its layout. */
function pageAndLayout(
  bundle: SiteDesignBundle,
  type: ContentTypeDefinition | undefined,
): { page: PageDesign; layout: SiteRenderInput['layout'] } {
  const page: PageDesign = type
    ? (bundle.pages[type.id] ?? generatePageDesign(type))
    : NOT_FOUND_PAGE;
  const layoutKey = page.layout ?? (type ? bundle.site.layouts?.[type.id] : undefined) ?? 'default';
  const layout = bundle.layouts[layoutKey] ?? bundle.layouts.default;
  return {
    page,
    layout: {
      key: bundle.layouts[layoutKey] ? layoutKey : 'default',
      design: layout as NonNullable<typeof layout>,
    },
  };
}

/** The shown document with its delivered fields, links rewritten for this site. */
async function documentInput(
  ctx: SiteLoaderContext,
  read: SiteRead,
  urls: SiteUrls,
  doc: ContentRow,
  locale: string,
): Promise<NonNullable<SiteRenderInput['document']>> {
  const [delivered] = await ctx.options.serialize([doc], read);
  const fields = delivered ? withSiteLinks(delivered, urls, locale) : undefined;
  const author = doc.createdBy ? await read.loaders.user.load(doc.createdBy) : null;
  return {
    id: doc.id,
    localizationId: doc.localizationId,
    typeId: doc.typeId,
    title: doc.title,
    permalink: urls.permalinkOf(doc),
    publishedAt: doc.publishedAt ? new Date(doc.publishedAt).toISOString() : null,
    author: author?.name ?? null,
    fields: fields ?? {},
  };
}

/** The document's translations in the site's locales, for `hreflang` links. */
async function alternatesOf(
  ctx: SiteLoaderContext,
  args: RenderInputArgs,
  doc: ContentRow,
): Promise<Array<{ locale: string; url: string }>> {
  const { context, read, urls } = args;
  const { space, scope } = context;
  const group = await ctx.options.repos.content.page(
    {
      spaceId: space.id,
      environmentId: scope.environmentId,
      localizationId: doc.localizationId,
    },
    { limit: 100, offset: 0 },
    [],
    read.published,
  );
  trackTouched(read.touched, group.items);
  const alternates: Array<{ locale: string; url: string }> = [];
  for (const row of group.items) {
    const permalink = urls.permalinkOf(row);
    if (permalink === null || !space.locales.includes(row.locale)) continue;
    alternates.push({ locale: row.locale, url: urls.absolute(row.locale, permalink) });
  }
  return alternates;
}

/** The assets the designs reference (logo, favicon, backgrounds), by id. */
async function designAssets(
  ctx: SiteLoaderContext,
  bundle: SiteDesignBundle,
  spaceId: string,
): Promise<Record<string, SiteAsset>> {
  const assets: Record<string, SiteAsset> = {};
  if (bundle.assetIds.length === 0) return assets;
  const rows = await ctx.options.repos.assets.listByIds(bundle.assetIds, spaceId);
  const url = ctx.options.assetUrl ?? ((asset: AssetRow) => designAssetUrl(asset.id));
  for (const asset of rows) {
    assets[asset.id] = {
      url: url(asset),
      width: asset.width,
      height: asset.height,
      alt: asset.alt,
      mimeType: asset.mimeType,
    };
  }
  return assets;
}

/** The menus the trees place, with links for this site and the shown page marked. */
async function siteMenus(
  read: SiteRead,
  urls: SiteUrls,
  roots: DesignNode[],
  locale: string,
  doc: ContentRow | null,
  tags: string[],
): Promise<Record<string, SiteMenu>> {
  const names = new Set<string>();
  for (const root of roots) {
    for (const node of menuNodes(root)) {
      const name = node.props?.menu;
      if (typeof name === 'string' && name) names.add(name);
    }
  }
  const found = await Promise.all(
    [...names].map(
      async (name) => [name, await read.reader.menu(read.spaceId, name, locale)] as const,
    ),
  );
  const out: Record<string, SiteMenu> = {};
  for (const [name, menu] of found) {
    if (!menu) continue;
    tags.push(`menu:${menu.id}`);
    out[name] = {
      id: menu.id,
      name: menu.name,
      machineName: menu.machineName,
      items: menuItems(menu.items, urls, locale, doc?.localizationId ?? null),
    };
  }
  return out;
}

function menuItems(
  items: PublicMenuItem[],
  urls: SiteUrls,
  locale: string,
  current: string | null,
): SiteMenuItem[] {
  return items.map((item) => {
    const children = menuItems(item.children, urls, locale, current);
    const permalink = item.content ? urls.permalinkOf(item.content) : null;
    const url =
      item.content && permalink !== null ? urls.href(item.content.locale, permalink) : item.url;
    const isCurrent =
      (current !== null && item.content?.localizationId === current) ||
      children.some((child) => child.current);
    return {
      id: item.id,
      label: item.label,
      url,
      target: item.target,
      ...(isCurrent ? { current: true } : {}),
      children,
    };
  });
}
