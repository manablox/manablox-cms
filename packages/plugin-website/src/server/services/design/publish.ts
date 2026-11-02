import { ManabloxError, type ResolvedScope, scopeSpaceId } from '@manablox/core';
import type { TransactionRepositories } from '@manablox/db';
import type { SiteDesignRow } from '../../db/index.js';
import { websiteRepos } from '../../db/index.js';
import { websiteKeys } from '../../keys.js';
import { bumpSiteRevision, readSiteSettings } from '../settings.service.js';
import { type DesignContext, findDesign } from './context.js';
import { designStatus, designTarget } from './summary.js';

/** Makes one design's draft live and bumps the site revision; a clean design is left alone. */
export async function publishDesign(
  ctx: DesignContext,
  scope: string | ResolvedScope,
  id: string,
  actorId: string | null,
): Promise<SiteDesignRow> {
  const spaceId = scopeSpaceId(scope);
  const row = await findDesign(ctx, scope, id);
  if (designStatus(row) === 'published') return row;
  return ctx.repos.transaction(async (tx) => {
    await tx.spaces.lockById(spaceId);
    const published = await publishRow(ctx, tx, row, actorId);
    await bumpSiteRevision(ctx.manablox, tx, spaceId);
    return published;
  });
}

/** Publishes every design with changes in one transaction, so the site never mixes them. */
export async function publishAllDesigns(
  ctx: DesignContext,
  scope: string | ResolvedScope,
  actorId: string | null,
): Promise<{ published: SiteDesignRow[]; revision: number }> {
  const spaceId = scopeSpaceId(scope);
  return ctx.repos.transaction(async (tx) => {
    const space = await tx.spaces.lockById(spaceId);
    if (!space) throw ManabloxError.notFound('space.notFound', { spaceId });
    const dirty = await websiteRepos(tx).designs.listDirty(scope);
    if (dirty.length === 0) {
      return { published: [], revision: (await readSiteSettings(tx, spaceId)).revision };
    }
    const published: SiteDesignRow[] = [];
    for (const row of dirty) published.push(await publishRow(ctx, tx, row, actorId));
    const revision = await bumpSiteRevision(ctx.manablox, tx, spaceId);
    return { published, revision };
  });
}

/** Publishes a row, keeps a version snapshot and prunes old ones by the retention setting. */
async function publishRow(
  ctx: DesignContext,
  tx: TransactionRepositories,
  row: SiteDesignRow,
  actorId: string | null,
): Promise<SiteDesignRow> {
  const published = await websiteRepos(tx).designs.publish(row.id, actorId);
  await websiteRepos(tx).designs.addVersion({
    designId: row.id,
    spaceId: row.spaceId,
    version: published.version,
    data: published.published,
    actorId,
  });
  const { retention } = await ctx.manablox.controls.resolved(row.spaceId);
  const keep = retention[websiteKeys.retention.designVersionsCount] ?? null;
  if (keep !== null) await websiteRepos(tx).designs.pruneVersions(row.spaceId, keep, row.id);
  await ctx.audit.in(tx).record('website.design.publish', designTarget(published), undefined, {
    kind: published.kind,
    key: published.key,
    version: published.version,
  });
  return published;
}
