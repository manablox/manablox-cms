import {
  inScope,
  ManabloxError,
  type ResolvedScope,
  scopeSpaceId,
  stagingIdOf,
} from '@manablox/core';
import { websiteKeys } from '../../keys.js';
import { signSiteShare } from '../../share.js';
import type { DesignContext } from './context.js';

/** Share links default to a day and last at most a month. */
const SHARE_LINK_DEFAULT_SECONDS = 24 * 60 * 60;
export const SHARE_LINK_MAX_SECONDS = 30 * 24 * 60 * 60;

/**
 * A signed, time-limited token for draft previews of the space, or of one document in it.
 * The caller composes the site URL.
 */
export async function createShareLink(
  ctx: DesignContext,
  scope: string | ResolvedScope,
  input: { contentId?: string | null | undefined; expiresInSeconds?: number | undefined },
): Promise<{ token: string; expiresAt: Date }> {
  const spaceId = scopeSpaceId(scope);
  const staging = stagingIdOf(scope);
  await ctx.manablox.controls.assertFeature(spaceId, websiteKeys.features.shareLinks);
  const seconds = input.expiresInSeconds ?? SHARE_LINK_DEFAULT_SECONDS;
  if (!Number.isInteger(seconds) || seconds < 60 || seconds > SHARE_LINK_MAX_SECONDS) {
    throw ManabloxError.badRequest('plugins.website.design.share.invalidExpiry', {
      min: 60,
      max: SHARE_LINK_MAX_SECONDS,
    });
  }
  const space = await ctx.repos.spaces.findById(spaceId);
  if (!space) throw ManabloxError.notFound('space.notFound', { spaceId });
  let label = space.name;
  if (input.contentId) {
    const row = await ctx.repos.content.findById(input.contentId);
    if (!row || !inScope(row, scope)) {
      throw ManabloxError.notFound('content.notFound', { id: input.contentId });
    }
    label = row.title;
  }
  const expiresAt = new Date(Date.now() + seconds * 1000);
  const token = signSiteShare(ctx.manablox.config.auth.secret, {
    spaceId,
    ...(staging ? { environmentId: staging } : {}),
    contentId: input.contentId ?? undefined,
    expiresAt,
  });
  await ctx.audit.record(
    'website.design.share',
    { id: input.contentId ?? null, spaceId, label },
    undefined,
    {
      contentId: input.contentId ?? null,
      expiresAt: expiresAt.toISOString(),
      ...(staging ? { environmentId: staging } : {}),
    },
  );
  return { token, expiresAt };
}
