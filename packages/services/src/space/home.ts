import {
  inScope,
  ManabloxError,
  nominationsOf,
  purgeTags,
  type ResolvedScope,
  scopeSpaceId,
  spacePurgeTag,
  stagingIdOf,
  withStagingNominations,
} from '@manablox/core';
import type { SpaceRow } from '@manablox/db';
import { onWrite } from '../content/listeners.js';
import { SpaceNominations } from '../nominations.js';
import type { SpaceContext } from './context.js';

/**
 * Nominates the environment's home document, stored in `settings` (a staging
 * environment's under `settings.environments`); `null` clears it.
 */
export async function setHome(
  ctx: SpaceContext,
  scope: string | ResolvedScope,
  contentId: string | null,
): Promise<SpaceRow> {
  const spaceId = scopeSpaceId(scope);
  const staging = stagingIdOf(scope);
  const space = await ctx.require(spaceId);

  if (contentId) {
    const row = await ctx.repos.content.findById(contentId);
    if (!row || !inScope(row, scope)) {
      throw ManabloxError.badRequest('content.notInSpace', { id: contentId });
    }
  }

  let settings = { ...space.settings };
  if (staging) settings = withStagingNominations(settings, staging, { homeContentId: contentId });
  else if (contentId) settings.homeContentId = contentId;
  else delete settings.homeContentId;

  return ctx.repos.transaction(async (tx) => {
    const saved = await tx.spaces.update(spaceId, { settings });
    await ctx.audit.in(tx).record(
      'space.setHome',
      saved,
      [
        {
          path: staging
            ? `settings.environments.${staging}.homeContentId`
            : 'settings.homeContentId',
          from: nominationsOf(space.settings, staging).homeContentId,
          to: contentId,
        },
      ],
      staging ? { environmentId: staging } : null,
    );
    // No content row changed, so purge the environment's cached home lookup.
    tx.afterCommit(() => purgeTags(ctx.manablox, spaceId, [spacePurgeTag(scope)]));
    return saved;
  });
}

/**
 * Clears nominations of deleted documents, every environment's, in the delete's transaction;
 * settings have no foreign keys.
 */
export function attachNominationCleanup(ctx: SpaceContext): void {
  onWrite(ctx.manablox, 'content:afterDeleteMany', async (rows, { spaceId }, repos) => {
    const nominations = await SpaceNominations.load(ctx.manablox, repos, spaceId);
    if (!nominations) return;
    const deleted = new Set(rows.map((row) => row.id));
    for (const stagingId of [null, ...nominations.stagingIds()]) {
      for (const nomination of nominations.list) {
        const id = nominations.get(stagingId, nomination);
        if (id && deleted.has(id)) nominations.set(stagingId, nomination, null);
      }
    }
    await nominations.save(repos);
  });
}
