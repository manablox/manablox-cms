import { type ContentListRequest, isDocumentType, ManabloxError } from '@manablox/core';
import type { ContentRow } from '@manablox/db';
import { type SiteContext, type SiteLoaderContext, siteReading, siteTypes } from './context.js';
import { siteUrls } from './documents.js';

export interface SitemapEntry {
  url: string;
  lastModified: string | null;
  alternates: Array<{ locale: string; url: string }>;
}

/** Documents per sitemap, the protocol's limit. */
const SITEMAP_MAX = 50_000;
/** Documents read per round trip. */
const SITEMAP_BATCH = 1000;

/** Published documents of every locale, with their translations as alternates. */
export async function sitemap(
  ctx: SiteLoaderContext,
  context: SiteContext,
  protocol: string,
): Promise<SitemapEntry[]> {
  const { space, scope } = context;
  const read = siteReading(ctx, scope, true, undefined);
  const urls = await siteUrls(context, read, protocol);
  const typeIds = siteTypes(ctx, scope)
    .filter((type) => isDocumentType(type) && !type.isSystem)
    .map((type) => type.id);
  if (typeIds.length === 0) return [];

  const rows: ContentRow[] = [];
  // Filtered by the list hooks like a delivery list.
  const request: ContentListRequest = { kind: 'list', typeIds, locale: null };
  let seen = 0;
  for await (const batch of ctx.options.repos.content.batches(
    { spaceId: space.id, environmentId: scope.environmentId, typeIds },
    { sorts: [{ by: 'createdAt', direction: 'asc' }], published: true, batch: SITEMAP_BATCH },
  )) {
    const kept = batch.slice(0, SITEMAP_MAX - seen);
    seen += kept.length;
    try {
      rows.push(...(await read.reader.listed(space.id, request, kept)));
    } catch (err) {
      if (err instanceof ManabloxError) return [];
      throw err;
    }
    if (seen >= SITEMAP_MAX) break;
  }

  const linked = rows
    .filter((row) => space.locales.includes(row.locale))
    .map((row) => ({ row, permalink: urls.permalinkOf(row) }))
    .filter((entry): entry is { row: ContentRow; permalink: string } => entry.permalink !== null);
  const groups = new Map<string, Array<{ locale: string; url: string }>>();
  for (const { row, permalink } of linked) {
    const group = groups.get(row.localizationId) ?? [];
    group.push({ locale: row.locale, url: urls.absolute(row.locale, permalink) });
    groups.set(row.localizationId, group);
  }
  return linked.map(({ row, permalink }) => {
    const group = groups.get(row.localizationId) ?? [];
    return {
      url: urls.absolute(row.locale, permalink),
      lastModified: row.publishedAt ? new Date(row.publishedAt).toISOString() : null,
      alternates: group.length > 1 ? group : [],
    };
  });
}

/** The origin a space's sitemap is served from: the primary host of the default locale. */
export async function primaryOrigin(
  ctx: SiteLoaderContext,
  context: SiteContext,
  protocol: string,
): Promise<string> {
  const read = siteReading(ctx, context.scope, true, undefined);
  return (await siteUrls(context, read, protocol)).origin(context.space.defaultLocale);
}
