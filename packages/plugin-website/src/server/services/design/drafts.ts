import {
  diffRecords,
  ManabloxError,
  type ResolvedScope,
  scopeSpaceId,
  snapshotChanges,
} from '@manablox/core';
import { isUniqueViolation } from '@manablox/db';
import type { SiteDesignKindName } from '../../../shared/site.js';
import type { SiteDesignRow, SiteDesignVersionRow } from '../../db/index.js';
import { websiteRepos } from '../../db/index.js';
import { bumpSiteRevision } from '../settings.service.js';
import { type DesignContext, findDesign } from './context.js';
import { assertDesignFeatures, assertDesignKey, validatedDesign } from './rules.js';
import { designStatus, designTarget } from './summary.js';

export interface SiteDesignSaveInput {
  kind: SiteDesignKindName;
  key: string;
  name?: string | undefined;
  draft: unknown;
  /** The stored version the draft was made from; `0` or absent for a generated design. */
  expectedVersion?: number | undefined;
}

/** A concurrent first save of the same design lost the race. */
const createConflict = (params: Record<string, unknown>) => (error: unknown) => {
  if (isUniqueViolation(error, 'site_designs')) {
    throw ManabloxError.conflict('plugins.website.design.versionConflict', params);
  }
  throw error;
};

/**
 * Validates and stores a draft. The first save of a generated design creates its row; later
 * saves need the stored `version`, so a stale editor gets a conflict instead of overwriting.
 */
export async function saveDesignDraft(
  ctx: DesignContext,
  scope: string | ResolvedScope,
  input: SiteDesignSaveInput,
  actorId: string | null,
): Promise<SiteDesignRow> {
  assertDesignKey(ctx.manablox, scope, input.kind, input.key);
  const draft = validatedDesign(input.kind, input.draft);
  const current = await websiteRepos(ctx.repos).designs.find(scope, input.kind, input.key);
  await assertDesignFeatures(
    ctx.manablox,
    scopeSpaceId(scope),
    input.kind,
    current?.draft ?? null,
    draft,
  );
  const expected = input.expectedVersion ?? 0;
  if ((current?.version ?? 0) !== expected) {
    throw ManabloxError.conflict('plugins.website.design.versionConflict', {
      kind: input.kind,
      key: input.key,
      expected,
      actual: current?.version ?? 0,
    });
  }

  return ctx.repos.transaction(async (tx) => {
    const row = current
      ? await websiteRepos(tx).designs.saveDraft(current.id, expected, {
          draft,
          name: input.name,
          actorId,
        })
      : await websiteRepos(tx)
          .designs.create({
            spaceId: scopeSpaceId(scope),
            ...(typeof scope === 'string' ? {} : { environmentId: scope.environmentId }),
            kind: input.kind,
            key: input.key,
            name: input.name,
            draft,
            actorId,
          })
          .catch(createConflict({ kind: input.kind, key: input.key }));
    if (!row) {
      throw ManabloxError.conflict('plugins.website.design.versionConflict', {
        kind: input.kind,
        key: input.key,
        expected,
      });
    }
    await ctx.audit
      .in(tx)
      .record(
        'website.design.save',
        designTarget(row),
        current ? diffRecords(current.draft ?? {}, row.draft ?? {}) : undefined,
        { kind: row.kind, key: row.key, version: row.version },
      );
    return row;
  });
}

/** Sets the draft back to the live copy; a never published design goes back to generated. */
export async function discardDesignDraft(
  ctx: DesignContext,
  scope: string | ResolvedScope,
  id: string,
  actorId: string | null,
): Promise<SiteDesignRow | null> {
  const row = await findDesign(ctx, scope, id);
  return ctx.repos.transaction(async (tx) => {
    const status = designStatus(row);
    const discarded =
      status === 'unpublished'
        ? null
        : status === 'changed'
          ? await websiteRepos(tx).designs.discardDraft(row.id, actorId)
          : row;
    if (!discarded) await websiteRepos(tx).designs.delete(row.id, scope);
    if (status !== 'published') {
      await ctx.audit.in(tx).record('website.design.discard', designTarget(row), undefined, {
        kind: row.kind,
        key: row.key,
        version: row.version,
      });
    }
    return discarded;
  });
}

/** Copies a snapshot into the draft; publishing it is a separate step. */
export async function restoreDesign(
  ctx: DesignContext,
  scope: string | ResolvedScope,
  row: SiteDesignRow,
  snapshot: SiteDesignVersionRow,
  actorId: string | null,
): Promise<SiteDesignRow> {
  const draft = validatedDesign(row.kind, snapshot.data);
  await assertDesignFeatures(ctx.manablox, scopeSpaceId(scope), row.kind, row.draft, draft);
  return ctx.repos.transaction(async (tx) => {
    const saved = await websiteRepos(tx).designs.saveDraft(row.id, row.version, {
      draft,
      actorId,
    });
    if (!saved) {
      throw ManabloxError.conflict('plugins.website.design.versionConflict', {
        kind: row.kind,
        key: row.key,
        expected: row.version,
      });
    }
    await ctx.audit.in(tx).record('website.design.restore', designTarget(saved), undefined, {
      kind: saved.kind,
      key: saved.key,
      version: snapshot.version,
    });
    return saved;
  });
}

/** Resets a design to generated; a live one changes the site, so the revision moves. */
export async function deleteDesign(
  ctx: DesignContext,
  scope: string | ResolvedScope,
  id: string,
): Promise<void> {
  const spaceId = scopeSpaceId(scope);
  const row = await findDesign(ctx, scope, id);
  await ctx.repos.transaction(async (tx) => {
    if (row.published !== null) await tx.spaces.lockById(spaceId);
    await websiteRepos(tx).designs.delete(row.id, scope);
    await ctx.audit
      .in(tx)
      .record(
        'website.design.delete',
        designTarget(row),
        snapshotChanges({ draft: row.draft }, 'deleted'),
        {
          kind: row.kind,
          key: row.key,
        },
      );
    if (row.published !== null) await bumpSiteRevision(ctx.manablox, tx, spaceId);
  });
}
