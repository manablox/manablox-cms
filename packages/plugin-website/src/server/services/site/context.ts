import type { LocalCache, TaggedCache, TouchedIds } from '@manablox/cache';
import type { ContentTypeDefinition, ResolvedScope } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { AssetRow, ContentRow, Repositories } from '@manablox/db';
import {
  cachedSpaceRows,
  createLoaders,
  DeliveryReader,
  type Loaders,
  type MenuService,
  type RedirectService,
} from '@manablox/services';
import type { SpaceSiteSettings } from '../../../shared/site.js';
import type { SiteSharePayload } from '../../share.js';
import type { ResolvedHost, SiteDomainService } from '../domain.service.js';
import type { SiteDesignBundle } from './designs.js';
import type { KeptLookup } from './lookup.js';

/** What a render reads documents through; handed to the field serializer. */
interface SiteReadContext {
  spaceId: string;
  reader: DeliveryReader;
  loaders: Loaders;
  touched: TouchedIds | undefined;
}

/** Documents' fields in delivery shape, in the order given. */
export type SiteFieldSerializer = (
  rows: ContentRow[],
  context: SiteReadContext,
) => Promise<Array<Record<string, unknown>>>;

export interface SiteLoaderOptions {
  manablox: Manablox;
  repos: Repositories;
  menus: MenuService;
  domains: SiteDomainService;
  redirects: RedirectService;
  /** Host, space and stylesheet lookups are kept here. */
  cache: TaggedCache;
  serialize: SiteFieldSerializer;
  /** URL of a design asset (logo, favicon, share image); `/media/<id>/original` by default. */
  assetUrl?: ((asset: AssetRow) => string) | undefined;
  /** Seconds host and space lookups are cached for. */
  ttl: number;
}

/** The parts of a space a site request needs; safe to cache as JSON. */
export interface SiteSpace {
  id: string;
  name: string;
  defaultLocale: string;
  locales: string[];
  settings: Record<string, unknown>;
}

export interface SiteDomainEntry {
  hostname: string;
  locale: string | null;
  isPrimary: boolean;
}

/** A host that serves a designed, ready space. */
export interface SiteContext {
  host: ResolvedHost;
  /** The environment the host belongs to. */
  scope: ResolvedScope;
  /** Port of the `Host` header; empty for the scheme's default. */
  port: string;
  space: SiteSpace;
  settings: SpaceSiteSettings;
  domains: SiteDomainEntry[];
}

export type SiteLookup =
  | { kind: 'unknown' }
  /** The host 301s to the primary one. */
  | { kind: 'moved'; hostname: string }
  /** Known, but not served: an external frontend, or an import still running. */
  | { kind: 'hidden'; spaceId: string }
  | { kind: 'site'; context: SiteContext };

/** A menu as the design bundle names it. */
export interface SiteMenuName {
  machineName: string;
  name: string;
}

/** What the loader's parts share: its options and the per-process memos. */
export interface SiteLoaderContext {
  options: SiteLoaderOptions;
  /** Host lookups, for seconds; purges drop them. */
  lookups: LocalCache<KeptLookup>;
  /** Each environment's menus by name, for the design bundle; purges drop them. */
  menuLists: LocalCache<SiteMenuName[]>;
  /** Built live design bundles, by revision, content model and menus. */
  bundles: Map<string, SiteDesignBundle>;
  /** Stylesheets by hash. */
  stylesheets: Map<string, string>;
}

/** How a request reads documents: published or drafts, recording what it touched. */
export type SiteRead = ReturnType<typeof siteReading>;

export function siteReading(
  ctx: SiteLoaderContext,
  scope: ResolvedScope,
  published: boolean,
  touched: TouchedIds | undefined,
) {
  const { spaceId } = scope;
  const loaders = createLoaders(ctx.options.repos, published, {
    spaceId,
    environment: scope,
    publishedAssetsOnly: published,
    spaceRows: cachedSpaceRows(ctx.options.manablox, ctx.options.repos),
  });
  const reader = new DeliveryReader({
    manablox: ctx.options.manablox,
    repos: ctx.options.repos,
    loaders,
    menus: ctx.options.menus,
    spaceId,
    scope,
    published,
    touched,
  });
  return { spaceId, scope, reader, loaders, touched, published };
}

/** The content types of an environment. */
export function siteTypes(ctx: SiteLoaderContext, scope: ResolvedScope): ContentTypeDefinition[] {
  return ctx.options.manablox.contentTypes.forSpace(scope);
}

/** A share link of the scope's space and environment; production when it names none. */
export function sharedWith(
  share: SiteSharePayload | null | undefined,
  scope: ResolvedScope,
): SiteSharePayload | null {
  if (!share || share.spaceId !== scope.spaceId) return null;
  const environmentId = share.environmentId ?? null;
  return environmentId
    ? environmentId === scope.environmentId
      ? share
      : null
    : scope.production
      ? share
      : null;
}
