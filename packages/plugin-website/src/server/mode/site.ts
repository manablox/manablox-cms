import {
  type MediaScope,
  markNotMetered,
  type Runtime,
  retryAfter,
  served,
  usageRefused,
  writable,
} from '@manablox/server';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { WEBSITE } from '../../shared/site.js';
import { websiteKeys } from '../keys.js';
import type { SiteDomainService } from '../services/domain.service.js';
import type { SiteLoader } from '../services/site/loader.js';
import type { WebsiteConfig } from '../services/site/options.js';
import { mountSiteAssets, siteMediaScope } from './site-assets.js';
import {
  admittedSiteLookup,
  createSiteSurfaceContext,
  featureOn,
  type SiteSurfaceContext,
  siteLookup,
  siteSpaceOf,
} from './site-context.js';
import { mountSiteForms, type SiteFormForwarder, type SiteFormsOptions } from './site-forms.js';
import { neutral, protocolOf } from './site-http.js';
import { mountSitePages } from './site-pages.js';
import { mountSitePassword } from './site-password.js';
import type { SiteRenderer } from './site-renderer.js';
import { mountSiteRobots } from './site-robots.js';
import { mountSiteSystem } from './site-system.js';

/** Paths served whatever the site's usage. */
const UNGATED = /^\/_manablox\/(domain-check|canvas|forms\/)/;

/** Mounted pieces of the site surface; `media` restricts `/media` to the request's site. */
export interface SiteSurface {
  loader: SiteLoader;
  media: (c: Context) => Promise<MediaScope | null>;
  /** The space the request's host serves, if any. */
  spaceOf: (c: Context) => Promise<string | null>;
  mount: (app: Hono) => void;
}

/**
 * The website mode: designed spaces rendered as HTML by `Host`, with their stylesheet,
 * islands, fonts, sitemap and robots, share links, forms and the design canvas. Without a
 * `forwarder` forms answer 503.
 */
export function createSiteSurface(
  runtime: Runtime,
  domains: SiteDomainService,
  config: WebsiteConfig,
  renderer: SiteRenderer,
  forwarder: SiteFormForwarder | null = null,
): SiteSurface {
  const ctx = createSiteSurfaceContext(runtime, domains, config, renderer);
  const spaceOf = (c: Context) => siteSpaceOf(ctx, c);

  // Registration order is route order: the page catch-all comes last.
  const mount = (app: Hono): void => {
    app.use('*', served(ctx.manablox, { surface: () => WEBSITE, spaceId: spaceOf }));
    app.use('*', usageGate(ctx));
    mountSiteSystem(app, ctx);
    mountSitePassword(app, {
      lookup: (c) => siteLookup(ctx, c),
      protocolOf,
      secret: ctx.secret,
      controls: () => ctx.manablox.controls,
      notFound: (c) => neutral(c, 404),
    });
    mountSiteForms(app, siteFormsOptions(ctx, forwarder));
    mountSiteAssets(app, ctx);
    mountSiteRobots(app, ctx);
    mountSitePages(app, ctx);
  };

  return { loader: ctx.loader, media: (c) => siteMediaScope(ctx, c), spaceOf, mount };
}

/** A site whose bandwidth is used up shows the neutral 503; forms answer for themselves. */
function usageGate(ctx: SiteSurfaceContext): MiddlewareHandler {
  return async (c, next) => {
    if (UNGATED.test(c.req.path)) return next();
    const spaceId = await siteSpaceOf(ctx, c);
    const refusal = await usageRefused(ctx.manablox, spaceId, ['bandwidthBytes']);
    if (!refusal) return next();
    markNotMetered(c);
    const response = neutral(c, 503);
    response.headers.set('retry-after', retryAfter(refusal));
    return response;
  };
}

function siteFormsOptions(
  ctx: SiteSurfaceContext,
  forwarder: SiteFormForwarder | null,
): SiteFormsOptions {
  const { manablox } = ctx;
  return {
    loader: ctx.loader,
    lookup: (c) => admittedSiteLookup(ctx, c),
    protocolOf,
    secret: ctx.secret,
    forwarder,
    config: ctx.config,
    controls: () => manablox.controls,
    onError: (error) => manablox.logger.warn({ err: error }, 'form forward failed'),
    notFound: (c) => neutral(c, 404),
    enabled: (spaceId) => featureOn(ctx, spaceId, websiteKeys.features.forms),
    // A read-only space takes no submissions either.
    usageBlocked: async (spaceId) =>
      !(await writable(manablox, spaceId)) ||
      (await usageRefused(manablox, spaceId, [
        websiteKeys.usage.formSubmissions,
        'bandwidthBytes',
      ])) !== null,
  };
}
