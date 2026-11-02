import { createTouchedIds, type TouchedIds, touchedTags } from '@manablox/cache';
import { environmentCacheTag, redirectsCacheTag, stagingIdOf } from '@manablox/core';
import type { SiteRenderInput } from '@manablox/site';
import { siteCacheTags } from '../../../shared/site.js';
import type { SiteSharePayload } from '../../share.js';
import { designBundle } from './bundle.js';
import { type SiteContext, type SiteLoaderContext, sharedWith, siteReading } from './context.js';
import { documentByPermalink, notFoundDocument, redirectFor, siteUrls } from './documents.js';
import { renderInput } from './input.js';
import type { SiteLocation } from './urls.js';

export interface SiteRenderOptions {
  /** `http:` or `https:`. */
  protocol: string;
  /** A verified share link for this space: drafts, draft designs, no cache. */
  share?: SiteSharePayload | null | undefined;
  /** Records what the render read, for cache tags; created when absent. */
  touched?: TouchedIds | undefined;
}

export type SiteRenderResult =
  | { kind: 'redirect'; location: string; status: number; tags: string[] }
  | {
      kind: 'page';
      input: SiteRenderInput;
      /** Cache tags of everything the page shows. */
      tags: string[];
      /** Whether drafts were read. */
      drafts: boolean;
    };

/** The page, redirect or not-found page for a located path. */
export async function renderSite(
  ctx: SiteLoaderContext,
  context: SiteContext,
  location: SiteLocation,
  options: SiteRenderOptions,
): Promise<SiteRenderResult> {
  const { space, scope } = context;
  const touched = options.touched ?? createTouchedIds();
  const share = sharedWith(options.share, scope);

  let read = siteReading(ctx, scope, !share, touched);
  let doc = await documentByPermalink(ctx, read, space.id, location);
  let drafts = share !== null;
  if (share?.contentId && doc) {
    // A link for one document shows only that document's draft.
    const shared = await read.loaders.content.load(share.contentId);
    if (shared?.localizationId !== doc.localizationId) {
      drafts = false;
      read = siteReading(ctx, scope, true, touched);
      doc = await documentByPermalink(ctx, read, space.id, location);
    }
  } else if (share?.contentId) {
    drafts = false;
    read = siteReading(ctx, scope, true, touched);
  }

  const urls = await siteUrls(context, read, options.protocol);
  const staging = stagingIdOf(scope);
  const tags = (extra: string[] = []) => [
    ...touchedTags(touched, space.id, staging ? environmentCacheTag(space.id, staging) : null),
    siteCacheTags.design(space.id),
    redirectsCacheTag(space.id),
    siteCacheTags.domains,
    siteCacheTags.pages,
    ...extra,
  ];

  if (!doc && location.permalink !== '') {
    const moved = await redirectFor(ctx, read, urls, scope, location, !drafts);
    if (moved) return { kind: 'redirect', ...moved, tags: tags() };
  }

  let status = 200;
  if (!doc) {
    status = 404;
    doc = await notFoundDocument(ctx, read, context, location.locale, !drafts);
  }

  const bundle = await designBundle(ctx, context, drafts ? 'draft' : 'published');
  const menuTags: string[] = [];
  const input = await renderInput(ctx, {
    context,
    read,
    urls,
    bundle,
    doc,
    location,
    status,
    mode: drafts ? 'share' : 'live',
    menuTags,
  });
  return { kind: 'page', input, tags: tags(menuTags), drafts };
}
