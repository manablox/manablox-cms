import { markCached, sharedCacheControl } from '@manablox/server';
import type { Hono } from 'hono';
import type { SitemapEntry } from '../services/site/sitemap.js';
import { type SiteSurfaceContext, siteLookup, siteShareOf } from './site-context.js';
import { NO_STORE, neutral, protocolOf } from './site-http.js';

/** `/robots.txt` and `/sitemap.xml`. */
export function mountSiteRobots(app: Hono, ctx: SiteSurfaceContext): void {
  const { loader, ttl } = ctx;

  app.get('/robots.txt', async (c) => {
    const found = await siteLookup(ctx, c);
    if (found.kind !== 'site') return neutral(c, 404);
    const { context } = found;
    const share = await siteShareOf(ctx, c, context);
    const locked = context.settings.password !== null;
    const site = await loader.siteSettings(context);
    const lines = ['User-agent: *'];
    // Staging is never indexed.
    if (!site.robots.index || share || locked || !context.scope.production) {
      lines.push('Disallow: /');
    } else {
      lines.push('Allow: /');
      if (site.robots.extra?.trim()) lines.push(site.robots.extra.trim());
      const origin = await loader.primaryOrigin(context, protocolOf(c));
      lines.push('', `Sitemap: ${origin}/sitemap.xml`);
    }
    return c.text(`${lines.join('\n')}\n`, 200, {
      'cache-control': share || locked ? NO_STORE : sharedCacheControl(ttl),
    });
  });

  app.get('/sitemap.xml', async (c) => {
    const found = await siteLookup(ctx, c);
    if (found.kind !== 'site') return neutral(c, 404);
    const { context } = found;
    if (context.settings.password !== null || !context.scope.production) return neutral(c, 404);
    const site = await loader.siteSettings(context);
    if (!site.robots.index) return neutral(c, 404);
    const protocol = protocolOf(c);
    const { cache } = ctx.runtime;
    const key = `site:sitemap:${context.space.id}:${context.settings.revision}:${context.host.hostname}:${context.port}:${protocol}`;
    const cached = ctx.cacheEnabled ? await cache.get<{ xml: string }>(key) : null;
    if (cached) markCached(c);
    const xml = cached?.xml ?? sitemapXml(await loader.sitemap(context, protocol));
    if (!cached && ctx.cacheEnabled) {
      await cache.set(
        key,
        { xml },
        {
          ttl,
          tags: [`space:${context.space.id}`, `design:${context.space.id}`, 'domains'],
        },
      );
    }
    return c.body(xml, 200, {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': sharedCacheControl(ttl),
    });
  });
}

const escapeXml = (value: string): string =>
  value.replace(/[<>&'"]/g, (char) => `&#${char.charCodeAt(0)};`);

function sitemapXml(entries: SitemapEntry[]): string {
  const urls = entries.map((entry) => {
    const parts = [`<loc>${escapeXml(entry.url)}</loc>`];
    if (entry.lastModified) parts.push(`<lastmod>${entry.lastModified}</lastmod>`);
    for (const alternate of entry.alternates) {
      parts.push(
        `<xhtml:link rel="alternate" hreflang="${escapeXml(alternate.locale)}" href="${escapeXml(alternate.url)}"/>`,
      );
    }
    return `<url>${parts.join('')}</url>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}
