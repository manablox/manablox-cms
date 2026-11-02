import { type PublicContext, serializeContents } from '@manablox/api-public';
import type { FeatureKey } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Runtime } from '@manablox/server';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { websiteKeys } from '../keys.js';
import type { SiteDomainService } from '../services/domain.service.js';
import {
  type SiteContext,
  type SiteFieldSerializer,
  type SiteLookup,
  sharedWith,
} from '../services/site/context.js';
import { SiteLoader } from '../services/site/loader.js';
import type { WebsiteConfig } from '../services/site/options.js';
import { type SiteSharePayload, verifySiteShare } from '../share.js';
import { editorOrigins } from './site-headers.js';
import { hostOf } from './site-http.js';
import { siteAdmitted } from './site-password.js';
import type { SiteRenderer } from './site-renderer.js';

declare module 'hono' {
  interface ContextVariableMap {
    /** The site space the request's host resolved to. */
    siteSpaceId?: string;
    /** The host's lookup, shared by everything that needs it during the request. */
    siteFound?: Promise<SiteLookup>;
  }
}

/** The cookie a share link sets. */
export const SITE_SHARE_COOKIE = 'mb_site_share';

/** What the site surface's route groups share. */
export interface SiteSurfaceContext {
  runtime: Runtime;
  manablox: Manablox;
  /** Signs and verifies share links, access cookies and form tokens. */
  secret: string;
  loader: SiteLoader;
  config: WebsiteConfig;
  renderer: SiteRenderer;
  cacheEnabled: boolean;
  /** Seconds pages, robots and sitemaps are cached for. */
  ttl: number;
  /** The admin origins that may frame the canvas. */
  origins: string[];
}

/** Relations are inlined with their fields: a page shows what a document links to. */
class ExpandAll extends Set<string> {
  override has(): boolean {
    return true;
  }
}

export function createSiteSurfaceContext(
  runtime: Runtime,
  domains: SiteDomainService,
  config: WebsiteConfig,
  renderer: SiteRenderer,
): SiteSurfaceContext {
  const { manablox } = runtime;
  return {
    runtime,
    manablox,
    secret: manablox.config.auth.secret,
    loader: siteLoader(runtime, domains),
    config,
    renderer,
    cacheEnabled: manablox.config.cache.enabled,
    ttl: config.cacheTtl ?? manablox.config.cache.ttl,
    origins: editorOrigins(config.editorOrigin),
  };
}

/** The loader, serializing documents with media URLs relative to the site's host. */
function siteLoader(runtime: Runtime, domains: SiteDomainService): SiteLoader {
  const { manablox } = runtime;
  const relative = relativeMedia(manablox);
  const serialize: SiteFieldSerializer = async (rows, read) => {
    const context: PublicContext = {
      manablox: relative,
      repos: runtime.repos,
      media: runtime.media,
      menus: runtime.menus,
      loaders: read.loaders,
      reader: read.reader,
      spaceId: read.spaceId,
      relatedFields: true,
      ...(read.touched ? { touched: read.touched } : {}),
    };
    return (await serializeContents(rows, context, new ExpandAll())).map((row) => row.fields);
  };
  return new SiteLoader({
    manablox,
    repos: runtime.repos,
    menus: runtime.menus,
    domains,
    redirects: runtime.redirects,
    cache: runtime.cache,
    serialize,
    assetUrl: (asset) => runtime.media.urlFor(asset),
    ttl: manablox.config.cache.ttl,
  });
}

/** The instance with media URLs left relative, so each site serves them from its own host. */
function relativeMedia(manablox: Manablox): Manablox {
  const config = Object.freeze({
    ...manablox.config,
    server: { ...manablox.config.server, publicUrl: '' },
  });
  return Object.create(manablox, { config: { value: config } }) as Manablox;
}

export async function featureOn(
  ctx: SiteSurfaceContext,
  spaceId: string,
  key: FeatureKey,
): Promise<boolean> {
  return (await ctx.manablox.controls.feature(spaceId, key)).enabled;
}

// --- Per-request lookups -------------------------------------------------------

/** The host's lookup, once per request. */
function foundFor(ctx: SiteSurfaceContext, c: Context): Promise<SiteLookup> {
  let found = c.get('siteFound');
  if (!found) {
    found = ctx.loader.site(hostOf(c));
    c.set('siteFound', found);
  }
  return found;
}

/** The request's site; a space where the plugin is off is not served. */
export async function siteLookup(ctx: SiteSurfaceContext, c: Context): Promise<SiteLookup> {
  const found = await foundFor(ctx, c);
  if (found.kind !== 'site') return found;
  const spaceId = found.context.space.id;
  if (!(await featureOn(ctx, spaceId, websiteKeys.feature))) return { kind: 'hidden', spaceId };
  c.set('siteSpaceId', spaceId);
  return found;
}

/** The request's site space, looked up once. */
export function siteSpaceOf(ctx: SiteSurfaceContext, c: Context): Promise<string | null> {
  const known = c.get('siteSpaceId');
  if (known !== undefined) return Promise.resolve(known);
  return foundFor(ctx, c).then((found) => (found.kind === 'site' ? found.context.space.id : null));
}

/**
 * The share link a request carries for this space environment, verified; none while
 * `shareLinks` is off.
 */
export async function siteShareOf(
  ctx: SiteSurfaceContext,
  c: Context,
  context: SiteContext,
): Promise<SiteSharePayload | null> {
  const token = getCookie(c, SITE_SHARE_COOKIE);
  if (!token) return null;
  const payload = sharedWith(verifySiteShare(ctx.secret, token), context.scope);
  if (!payload) return null;
  return (await featureOn(ctx, payload.spaceId, websiteKeys.features.shareLinks)) ? payload : null;
}

/** Whether a request passes the site password: the right cookie, or a share link. */
export async function siteAdmittedFor(
  ctx: SiteSurfaceContext,
  c: Context,
  context: SiteContext,
  share?: SiteSharePayload | null,
): Promise<boolean> {
  return (
    siteAdmitted(c, ctx.secret, context) ||
    (share !== undefined ? share : await siteShareOf(ctx, c, context)) !== null
  );
}

/** `siteLookup`, with a password-protected site hidden from requests not let in. */
export async function admittedSiteLookup(ctx: SiteSurfaceContext, c: Context): Promise<SiteLookup> {
  const found = await siteLookup(ctx, c);
  if (found.kind !== 'site' || (await siteAdmittedFor(ctx, c, found.context))) return found;
  return { kind: 'hidden', spaceId: found.context.space.id };
}
