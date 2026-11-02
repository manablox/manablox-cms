import { type ResolvedScope, spacePurgeTag } from '@manablox/core';
import { compileSiteCss, type InstanceStyle } from '@manablox/site';
import type { SiteDesignRow } from '../../db/index.js';
import { websiteRepos } from '../../db/index.js';
import {
  type SiteContext,
  type SiteLoaderContext,
  type SiteMenuName,
  siteTypes,
} from './context.js';
import {
  buildDesignBundle,
  cssHash,
  type SiteDesignBundle,
  type SiteDesignVariant,
} from './designs.js';
import { cachedSpace } from './lookup.js';

/** Built design bundles kept per process. */
const BUNDLE_MEMO = 64;
/** Stylesheets kept per process and in the shared cache, by hash. */
const CSS_MEMO = 128;
const CSS_TTL = 7 * 24 * 60 * 60;

/**
 * Designs of the environment; the live set is built once per revision, content model and
 * menus.
 */
export async function designBundle(
  ctx: SiteLoaderContext,
  context: Pick<SiteContext, 'space' | 'settings' | 'scope'>,
  variant: SiteDesignVariant,
): Promise<SiteDesignBundle> {
  const { space, settings, scope } = context;
  const { repos, manablox } = ctx.options;
  const menus = await siteMenuList(ctx, scope);
  const key = [
    space.id,
    scope.environmentId,
    settings.revision,
    manablox.contentTypes.schemaVersionOf(scope),
    space.name,
    space.defaultLocale,
    menus.map((menu) => menu.machineName).join(','),
  ].join(':');
  if (variant === 'published') {
    const memo = ctx.bundles.get(key);
    if (memo) return memo;
  }

  const rows: SiteDesignRow[] = await websiteRepos(repos).designs.listBySpace(scope);
  const bundle = buildDesignBundle({
    space,
    rows,
    variant,
    types: siteTypes(ctx, scope),
    menus,
  });
  if (variant === 'published') remember(ctx.bundles, key, bundle, BUNDLE_MEMO);
  await keepStylesheet(ctx, bundle.cssHash, bundle.css);
  return bundle;
}

/** The environment's menus by name, kept in process until a menu write purges the scope. */
function siteMenuList(ctx: SiteLoaderContext, scope: ResolvedScope): Promise<SiteMenuName[]> {
  return ctx.menuLists.load(scope.environmentId, async () => ({
    value: (await ctx.options.repos.menus.listBySpace(scope)).map((menu) => ({
      machineName: menu.machineName,
      name: menu.name,
    })),
    tags: [spacePurgeTag(scope)],
  }));
}

/** A stylesheet a page linked to, by hash; rebuilt from the host's space when evicted. */
export async function stylesheet(
  ctx: SiteLoaderContext,
  hash: string,
  context: SiteContext | null,
): Promise<string | null> {
  const memo = ctx.stylesheets.get(hash);
  if (memo !== undefined) return memo;
  const cached = await ctx.options.cache.get<{ css: string }>(cssKey(hash));
  if (cached) return cached.css;
  if (!context) return null;
  const bundle = await designBundle(ctx, context, 'published');
  return bundle.cssHash === hash ? bundle.css : null;
}

/**
 * The stylesheet of a page whose blocks carry instance overrides: the site's rules plus a
 * class per override. Returns its URL.
 */
export async function instanceStylesheet(
  ctx: SiteLoaderContext,
  context: SiteContext,
  drafts: boolean,
  styles: readonly InstanceStyle[],
): Promise<string> {
  const bundle = await designBundle(ctx, context, drafts ? 'draft' : 'published');
  const css = compileSiteCss({ ...bundle.cssInput, instanceStyles: [...styles] });
  const hash = cssHash(css);
  await keepStylesheet(ctx, hash, css);
  return `/_site/${hash}.css`;
}

/**
 * Whether the live designs of an asset's space reference it (fonts, backgrounds, logo): the
 * scope's, production's when absent.
 */
export async function designUsesAsset(
  ctx: SiteLoaderContext,
  spaceId: string,
  assetId: string,
  scope?: ResolvedScope | null,
): Promise<boolean> {
  const found = await cachedSpace(ctx, spaceId);
  if (!found?.ready) return false;
  const settings = found.site;
  if (settings.mode !== 'designed') return false;
  const { ready: _ready, site: _site, ...space } = found;
  const environment = scope ?? (await ctx.options.repos.environments.resolve(spaceId));
  if (!environment) return false;
  return (
    await designBundle(ctx, { space, settings, scope: environment }, 'published')
  ).assetIds.includes(assetId);
}

/** Keeps a stylesheet servable by hash, here and for other replicas. */
async function keepStylesheet(ctx: SiteLoaderContext, hash: string, css: string): Promise<void> {
  if (ctx.stylesheets.has(hash)) return;
  remember(ctx.stylesheets, hash, css, CSS_MEMO);
  await ctx.options.cache.set(cssKey(hash), { css }, { ttl: CSS_TTL });
}

function cssKey(hash: string): string {
  return `site:css:${hash}`;
}

/** Sets a key, dropping the oldest entries past `max`. */
function remember<T>(map: Map<string, T>, key: string, value: T, max: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}
