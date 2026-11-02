import { keyDigest, responseDigest } from '@manablox/cache';
import {
  markCached,
  matchesEtag,
  sharedCacheControl,
  withRateLimitHeaders,
} from '@manablox/server';
import type { Context, Hono } from 'hono';
import { websiteKeys } from '../keys.js';
import type { SiteContext } from '../services/site/context.js';
import { signSiteFormType, verifySiteFormResult } from '../services/site/forms.js';
import type { SiteLocation } from '../services/site/urls.js';
import type { SiteSharePayload } from '../share.js';
import {
  type SiteSurfaceContext,
  siteAdmittedFor,
  siteLookup,
  siteShareOf,
} from './site-context.js';
import { FORM_RESULT_PARAM } from './site-forms.js';
import { hasSiteCode, sitePagePolicy } from './site-headers.js';
import { hostOf, NO_STORE, neutral, protocolOf } from './site-http.js';
import { sitePasswordPage } from './site-password.js';

/** A rendered answer as the HTML cache keeps it. */
interface CachedPage {
  status: number;
  body: string;
  location: string | null;
  digest: string;
  /** Head or body code is set, so the page gets the relaxed CSP. */
  relaxed: boolean;
  noindex: boolean;
}

/** The "made with" badge a space shows, when on. */
type SiteBadge = { text: string; link: string };

/** A located page request of a site the visitor may see. */
interface PageRequest {
  context: SiteContext;
  located: SiteLocation;
  protocol: string;
  share: SiteSharePayload | null;
  /** The site has a password. */
  locked: boolean;
  /** The result of a form posted without JavaScript. */
  formResult: ReturnType<typeof verifySiteFormResult>;
  badge: SiteBadge | null;
}

/** Every other path: the site's pages, from the HTML cache or rendered. */
export function mountSitePages(app: Hono, ctx: SiteSurfaceContext): void {
  app.get('*', (c) => sitePage(ctx, c));
}

async function sitePage(ctx: SiteSurfaceContext, c: Context): Promise<Response> {
  const { manablox, ttl } = ctx;
  const { cache } = ctx.runtime;
  const found = await siteLookup(ctx, c);
  if (found.kind === 'unknown' || found.kind === 'hidden') return neutral(c, 404);
  const protocol = protocolOf(c);
  const { pathname, search } = new URL(c.req.url);
  if (found.kind === 'moved') {
    const port = /:(\d{1,5})$/.exec(hostOf(c))?.[1];
    c.header('cache-control', sharedCacheControl(ttl));
    // The raw path: still percent-encoded, so nothing in it can leave the header.
    return c.redirect(
      `${protocol}//${found.hostname}${port ? `:${port}` : ''}${pathname}${search}`,
      301,
    );
  }
  const { context } = found;
  const share = await siteShareOf(ctx, c, context);
  // A protected site answers the password form; a share link previews without it.
  const locked = context.settings.password !== null;
  if (locked && !(await siteAdmittedFor(ctx, c, context, share))) {
    return sitePasswordPage(c, `${pathname}${search}`);
  }
  const located = ctx.loader.locate(context, c.req.path);
  if ('redirect' in located) {
    c.header('cache-control', locked ? NO_STORE : sharedCacheControl(ttl));
    return c.redirect(`${located.redirect}${search}`, 301);
  }

  // The page after a form posted without JavaScript shows its result, uncached.
  const token = c.req.query(FORM_RESULT_PARAM);
  const formResult = token ? verifySiteFormResult(ctx.secret, token, context.space.id) : null;
  const badge = await siteBadge(ctx, context.space.id);
  const request: PageRequest = { context, located, protocol, share, locked, formResult, badge };
  const key = pageKey(ctx, request);
  const hit = key ? await cache.get<CachedPage>(key) : null;
  if (hit) {
    markCached(c);
    return respond(ctx, c, hit, false);
  }

  // Renders cost the most, so they have a budget of their own per space.
  const renders = await manablox.controls.rate(context.space.id, [
    { rule: websiteKeys.rateLimits.renders, key: context.space.id },
  ]);
  if (renders && !renders.allowed) return withRateLimitHeaders(neutral(c, 429), renders);

  const { page, drafts, tags } = await renderPage(ctx, request);
  if (key && !drafts) await cache.set(key, page, { ttl, tags });
  // A share preview never reaches a shared cache, even where it renders live content.
  return respond(ctx, c, page, share !== null || drafts || formResult !== null || locked);
}

async function siteBadge(ctx: SiteSurfaceContext, spaceId: string): Promise<SiteBadge | null> {
  const controls = await ctx.manablox.controls.resolved(spaceId);
  return controls.features[websiteKeys.features.badge]?.enabled
    ? {
        text: String(controls.settings.plugins['website.badge.text']),
        link: String(controls.settings.plugins['website.badge.link']),
      }
    : null;
}

/** The HTML cache key of a page; `null` for answers kept out of the shared cache. */
function pageKey(ctx: SiteSurfaceContext, request: PageRequest): string | null {
  const { context, located, badge } = request;
  // Protected pages never reach the shared cache.
  if (!ctx.cacheEnabled || request.share || request.formResult || request.locked) return null;
  return [
    'site',
    context.space.id,
    context.settings.revision,
    context.host.hostname,
    context.port,
    request.protocol,
    located.locale,
    keyDigest(located.permalink),
    badge ? keyDigest(badge.text, badge.link) : '-',
  ].join(':');
}

/** The page, redirect or not-found page rendered fresh, with its cache tags. */
async function renderPage(
  ctx: SiteSurfaceContext,
  request: PageRequest,
): Promise<{ page: CachedPage; drafts: boolean; tags: string[] }> {
  const { loader, renderer, secret } = ctx;
  const { context, located, protocol, share, formResult, badge } = request;
  const result = await loader.render(context, located, { protocol, share });
  if (result.kind === 'redirect') {
    const page: CachedPage = {
      status: result.status,
      body: '',
      location: result.location,
      digest: responseDigest(result.location),
      relaxed: false,
      noindex: false,
    };
    return { page, drafts: false, tags: result.tags };
  }
  const rendered = await renderer.renderPage(result.input, {
    formToken: (ref, typeId) => signSiteFormType(secret, ref, typeId),
    ...(formResult ? { formResult } : {}),
    ...(badge ? { badge } : {}),
  });
  let html = rendered.html;
  if (rendered.instanceStyles?.length) {
    const href = await loader.instanceStylesheet(context, result.drafts, rendered.instanceStyles);
    html = html.replace(`href="${result.input.cssHref}"`, `href="${href}"`);
  }
  const page: CachedPage = {
    status: rendered.status,
    body: html,
    location: null,
    digest: responseDigest(html),
    relaxed: hasSiteCode(result.input.site),
    noindex: result.drafts || request.locked || !result.input.site.robots.index,
  };
  return { page, drafts: result.drafts, tags: result.tags };
}

/** A cached or fresh answer with its cache, robots and security headers; `drafts` is private. */
function respond(ctx: SiteSurfaceContext, c: Context, page: CachedPage, drafts: boolean): Response {
  const headers: Record<string, string> = {
    'cache-control': drafts ? NO_STORE : sharedCacheControl(ctx.ttl),
  };
  if (page.location !== null) {
    return new Response(null, {
      status: page.status,
      headers: { ...headers, location: page.location },
    });
  }
  const etag = `W/"${page.digest}"`;
  Object.assign(headers, {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': sitePagePolicy(page.relaxed),
    'x-frame-options': 'DENY',
    etag,
  });
  if (page.noindex) headers['x-robots-tag'] = 'noindex, nofollow';
  if (!drafts && page.status === 200 && matchesEtag(c.req.header('if-none-match'), etag)) {
    return new Response(null, {
      status: 304,
      headers: { etag, 'cache-control': headers['cache-control'] as string },
    });
  }
  // A known length keeps the answer off the chunked path.
  headers['content-length'] = String(Buffer.byteLength(page.body));
  return c.body(page.body, page.status as 200, headers);
}
