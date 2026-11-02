import {
  isDocumentType,
  ManabloxError,
  nominationsOf,
  type ResolvedScope,
  stagingIdOf,
} from '@manablox/core';
import type { ContentRow } from '@manablox/db';
import { normaliseRedirectPath } from '@manablox/services';
import { type SiteContext, type SiteLoaderContext, type SiteRead, siteReading } from './context.js';
import { type SiteLocation, SiteUrls } from './urls.js';

/** The document at a located path; `null` when there is none or it is not a document. */
export async function documentByPermalink(
  ctx: SiteLoaderContext,
  read: SiteRead,
  spaceId: string,
  location: SiteLocation,
): Promise<ContentRow | null> {
  try {
    const row = await read.reader.byPermalink(spaceId, location.permalink, location.locale);
    if (!row) return null;
    const type = ctx.options.manablox.contentTypes.tryGet(row.typeId);
    return type && isDocumentType(type) ? row : null;
  } catch (error) {
    // A read hook refusing the document reads as a miss.
    if (ManabloxError.is(error) && error.kind === 'not_found') return null;
    throw error;
  }
}

/** Links of a site for one request: its hosts, locales and home page. */
export async function siteUrls(
  context: SiteContext,
  read: SiteRead,
  protocol: string,
): Promise<SiteUrls> {
  const homeId = nominationsOf(context.space.settings, stagingIdOf(context.scope)).homeContentId;
  const home = homeId ? await read.loaders.content.load(homeId) : null;
  return new SiteUrls(
    context.space,
    context.settings,
    context.domains,
    context.host,
    protocol,
    home?.localizationId ?? null,
    defaultPort(protocol, context.port) ? '' : context.port,
  );
}

/** The redirect a missed path answers with, if any. */
export async function redirectFor(
  ctx: SiteLoaderContext,
  read: SiteRead,
  urls: SiteUrls,
  scope: ResolvedScope,
  location: SiteLocation,
  published: boolean,
): Promise<{ location: string; status: number } | null> {
  const path = normaliseRedirectPath(`/${location.permalink}`);
  if (!path) return null;
  const row = await ctx.options.redirects.lookup(scope, location.locale, path);
  if (!row) return null;
  if (row.toPath) {
    if (/^https?:\/\//i.test(row.toPath)) return { location: row.toPath, status: row.status };
    return { location: urls.href(location.locale, row.toPath), status: row.status };
  }
  if (!row.toContentId) return null;
  const target = await inLocale(ctx, read, scope, row.toContentId, location.locale, published);
  const permalink = target ? urls.permalinkOf(target) : null;
  if (permalink === null) return null;
  return { location: urls.href(location.locale, permalink), status: row.status };
}

/** The document of a localization group in one locale, through the read hooks. */
async function inLocale(
  ctx: SiteLoaderContext,
  read: SiteRead,
  scope: ResolvedScope,
  localizationId: string,
  locale: string,
  published: boolean,
): Promise<ContentRow | null> {
  const page = await ctx.options.repos.content.page(
    { spaceId: scope.spaceId, environmentId: scope.environmentId, localizationId, locale },
    { limit: 1, offset: 0 },
    [],
    published,
  );
  const found = page.items[0];
  if (!found) return null;
  return (await read.reader.byIds([found.id])).get(found.id) ?? null;
}

/** The nominated not-found document in a locale. */
export async function notFoundDocument(
  ctx: SiteLoaderContext,
  read: SiteRead,
  context: SiteContext,
  locale: string,
  published: boolean,
): Promise<ContentRow | null> {
  const id = context.settings.notFoundContentId;
  if (!id) return null;
  const nominated = await read.loaders.content.load(id);
  if (!nominated) return null;
  return inLocale(ctx, read, context.scope, nominated.localizationId, locale, published);
}

/** Where a share link lands: the shared document's draft path, else the home page. */
export async function sharePath(
  ctx: SiteLoaderContext,
  context: SiteContext,
  contentId: string | undefined,
  protocol: string,
): Promise<string> {
  if (!contentId) return '/';
  const read = siteReading(ctx, context.scope, false, undefined);
  const row = await read.loaders.content.load(contentId);
  if (!row) return '/';
  const urls = await siteUrls(context, read, protocol);
  const permalink = urls.permalinkOf(row);
  return permalink === null ? '/' : urls.href(row.locale, permalink);
}

/** Link to a published document in a locale, for a form's redirect target. */
export async function documentHref(
  ctx: SiteLoaderContext,
  context: SiteContext,
  contentId: string,
  locale: string,
  protocol: string,
): Promise<string | null> {
  const read = siteReading(ctx, context.scope, true, undefined);
  const row = await read.loaders.content.load(contentId);
  if (!row) return null;
  const target =
    (await inLocale(ctx, read, context.scope, row.localizationId, locale, true)) ?? row;
  const urls = await siteUrls(context, read, protocol);
  const permalink = urls.permalinkOf(target);
  return permalink === null ? null : urls.href(target.locale, permalink);
}

function defaultPort(protocol: string, port: string): boolean {
  return (
    port === '' ||
    (protocol === 'http:' && port === '80') ||
    (protocol === 'https:' && port === '443')
  );
}
