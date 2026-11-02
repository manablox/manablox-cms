import { localCache } from '@manablox/cache';
import type { ResolvedScope } from '@manablox/core';
import type { InstanceStyle } from '@manablox/site';
import { designBundle, designUsesAsset, instanceStylesheet, stylesheet } from './bundle.js';
import {
  type SiteContext,
  type SiteLoaderContext,
  type SiteLoaderOptions,
  type SiteLookup,
  siteTypes,
} from './context.js';
import { documentHref, sharePath } from './documents.js';
import { findSiteFormNode, type SiteForm, type SiteFormKind } from './forms.js';
import { LOOKUP_TTL_MS, LOOKUPS_KEPT, lookupSite, resolveHost } from './lookup.js';
import { renderSite, type SiteRenderOptions, type SiteRenderResult } from './render.js';
import { primaryOrigin, type SitemapEntry, sitemap } from './sitemap.js';
import { locateSitePath, type SiteLocation } from './urls.js';

/**
 * Builds what the site process renders: host to space and locale, path to document,
 * redirects and the not-found page, and a `SiteRenderInput` with every design resolved
 * (stored ones of the current revision, generated ones for the rest). The parts sit next to
 * it: `lookup.ts` (the per-request host, space and domain lookups), `documents.ts`,
 * `bundle.ts` (designs and stylesheets, memoised per process), `render.ts` and `input.ts`,
 * `sitemap.ts`.
 */
export class SiteLoader {
  private readonly ctx: SiteLoaderContext;

  constructor(options: SiteLoaderOptions) {
    this.ctx = {
      options,
      lookups: localCache(options.manablox, { max: LOOKUPS_KEPT, ttlMs: LOOKUP_TTL_MS }),
      menuLists: localCache(options.manablox, { max: LOOKUPS_KEPT, ttlMs: LOOKUP_TTL_MS }),
      bundles: new Map(),
      stylesheets: new Map(),
    };
  }

  // --- Host ----------------------------------------------------------------

  /**
   * What a `Host` header names. A staging environment's host needs `environments`; while it
   * is off the host is unknown.
   */
  site(hostHeader: string): Promise<SiteLookup> {
    return lookupSite(this.ctx, hostHeader);
  }

  /** Whether a host is known; for on-demand TLS. */
  async knowsHost(hostHeader: string): Promise<boolean> {
    return (await resolveHost(this.ctx, hostHeader)) !== null;
  }

  locate(context: SiteContext, pathname: string): SiteLocation | { redirect: string } {
    return locateSitePath(context.space, context.host, pathname);
  }

  // --- Pages ---------------------------------------------------------------

  /** The page, redirect or not-found page for a located path. */
  render(
    context: SiteContext,
    location: SiteLocation,
    options: SiteRenderOptions,
  ): Promise<SiteRenderResult> {
    return renderSite(this.ctx, context, location, options);
  }

  /** Where a share link lands: the shared document's draft path, else the home page. */
  sharePath(
    context: SiteContext,
    contentId: string | undefined,
    protocol: string,
  ): Promise<string> {
    return sharePath(this.ctx, context, contentId, protocol);
  }

  // --- Sitemap -------------------------------------------------------------

  /** Published documents of every locale, with their translations as alternates. */
  sitemap(context: SiteContext, protocol: string): Promise<SitemapEntry[]> {
    return sitemap(this.ctx, context, protocol);
  }

  /** The origin a space's sitemap is served from: the primary host of the default locale. */
  primaryOrigin(context: SiteContext, protocol: string): Promise<string> {
    return primaryOrigin(this.ctx, context, protocol);
  }

  /** The live site settings design, for robots.txt. */
  async siteSettings(context: SiteContext, drafts = false) {
    return (await designBundle(this.ctx, context, drafts ? 'draft' : 'published')).site;
  }

  // --- Forms ---------------------------------------------------------------

  /**
   * A published form of the space and its data type; `null` when either is missing. A form
   * bound to a field takes `boundTypeId`, the verified type it was rendered with.
   */
  async form(
    context: SiteContext,
    kind: SiteFormKind,
    key: string,
    nodeId: string,
    boundTypeId?: string | null,
  ): Promise<SiteForm | null> {
    const bundle = await designBundle(this.ctx, context, 'published');
    const node = findSiteFormNode(bundle, kind, key, nodeId);
    if (!node) return null;
    const bound = node.bind !== undefined;
    const typeId = bound ? boundTypeId : node.props?.databagTypeId;
    if (typeof typeId !== 'string') return null;
    const type = siteTypes(this.ctx, context.scope).find(
      (entry) => entry.id === typeId && entry.kind === 'data' && !entry.isSystem,
    );
    const ref = `${kind}:${key}:${nodeId}`;
    return type ? { ref: bound ? `${ref}@${type.id}` : ref, node, type } : null;
  }

  /** Link to a published document in a locale, for a form's redirect target. */
  documentHref(
    context: SiteContext,
    contentId: string,
    locale: string,
    protocol: string,
  ): Promise<string | null> {
    return documentHref(this.ctx, context, contentId, locale, protocol);
  }

  // --- Stylesheets and assets ----------------------------------------------

  /** A stylesheet this process holds, by hash. */
  keptStylesheet(hash: string): string | undefined {
    return this.ctx.stylesheets.get(hash);
  }

  /** A stylesheet a page linked to, by hash; rebuilt from the host's space when evicted. */
  stylesheet(hash: string, context: SiteContext | null): Promise<string | null> {
    return stylesheet(this.ctx, hash, context);
  }

  /**
   * The stylesheet of a page whose blocks carry instance overrides: the site's rules plus a
   * class per override. Returns its URL.
   */
  instanceStylesheet(
    context: SiteContext,
    drafts: boolean,
    styles: readonly InstanceStyle[],
  ): Promise<string> {
    return instanceStylesheet(this.ctx, context, drafts, styles);
  }

  /**
   * Whether the live designs of an asset's space reference it (fonts, backgrounds, logo): the
   * scope's, production's when absent.
   */
  designUsesAsset(
    spaceId: string,
    assetId: string,
    scope?: ResolvedScope | null,
  ): Promise<boolean> {
    return designUsesAsset(this.ctx, spaceId, assetId, scope);
  }
}
