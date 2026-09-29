import {
  type AnyLimitKey,
  type ResolvedScope,
  type SpaceRole,
  scopeSpaceId,
  stagingIdOf,
} from '@manablox/core';
import type { TransactionRepositories } from '@manablox/db';
import type { ImportResult, TransferSelection } from '../transfer/format.js';
import type { ImportFileSource } from '../transfer/staging.js';
import type { SpaceContext } from './context.js';
import { auditMember, beforeGrant, seatsChanged } from './members.js';

/** Audited, since an export holds every document. A staging scope exports that environment. */
export async function exportSpace(
  ctx: SpaceContext,
  scope: string | ResolvedScope,
  selection?: TransferSelection,
) {
  const spaceId = scopeSpaceId(scope);
  await ctx.manablox.controls.assertFeature(spaceId, 'transferExport');
  const result = await ctx.transfer.export(scope, selection ?? {});
  const space = await ctx.repos.spaces.findById(spaceId);
  const staging = stagingIdOf(scope);
  await ctx.audit.record('space.export', { id: spaceId, name: space?.name ?? null }, undefined, {
    sections: result.sections,
    ...(staging ? { environmentId: staging } : {}),
  });
  return result;
}

/**
 * Restores an export with its ids; the importer becomes owner when the space is created.
 * `files` stages the archive's asset files first.
 */
export async function importSpace(
  ctx: SpaceContext,
  payload: unknown,
  ownerId: string,
  selection?: TransferSelection,
  files?: ImportFileSource,
) {
  // Always a new space.
  await ctx.manablox.controls.assertFeature(null, 'spaceCreate');
  await ctx.manablox.controls.assertFeature(null, 'transferImport');
  return ctx.transfer.import(payload, ownerId, selection ?? {}, {
    files,
    created: async (repos, spaceId) => {
      await beforeGrant(ctx, spaceId, ownerId, 'owner', null);
      await repos.users.grant(ownerId, spaceId, 'owner');
      await auditMember(ctx, 'member.grant', { id: spaceId }, ownerId, null, 'owner', repos);
      const space = await repos.spaces.findById(spaceId);
      if (space) await ctx.spaceEvent('space.created', space, repos);
      await seatsChanged(ctx, spaceId, [ownerId], 'added', repos);
    },
    finished: (repos, result) => auditImport(ctx, repos, result),
  });
}

/** Continues an interrupted import from its staged file; checked like `import`. */
export async function resumeImport(ctx: SpaceContext, spaceId: string) {
  await ctx.manablox.controls.assertFeature(null, 'spaceCreate');
  await ctx.manablox.controls.assertFeature(null, 'transferImport');
  return ctx.transfer.resume(spaceId, (repos, result) => auditImport(ctx, repos, result));
}

/**
 * Imports an export as a new space with these members, as a snapshot restore does; the
 * caller checks the features. `limitOffset` is what a replaced space already counts.
 */
export async function importRestored(
  ctx: SpaceContext,
  payload: unknown,
  members: ReadonlyArray<{ userId: string; role: SpaceRole }>,
  options: { actorId?: string | null; limitOffset?: Partial<Record<AnyLimitKey, number>> } = {},
): Promise<ImportResult> {
  return ctx.transfer.import(
    payload,
    options.actorId ?? null,
    {},
    {
      limitOffset: options.limitOffset,
      created: async (repos, spaceId) => {
        for (const { userId, role } of members) {
          await beforeGrant(ctx, spaceId, userId, role, null);
          await repos.users.grant(userId, spaceId, role);
          await auditMember(ctx, 'member.grant', { id: spaceId }, userId, null, role, repos);
        }
        const space = await repos.spaces.findById(spaceId);
        if (space) await ctx.spaceEvent('space.created', space, repos);
        await seatsChanged(
          ctx,
          spaceId,
          members.map((member) => member.userId),
          'added',
          repos,
        );
      },
      finished: (repos, result) => auditImport(ctx, repos, result),
    },
  );
}

async function auditImport(
  ctx: SpaceContext,
  repos: TransactionRepositories,
  result: ImportResult,
): Promise<void> {
  const space = await repos.spaces.findById(result.spaceId);
  await ctx.audit
    .in(repos)
    .record('space.import', { id: result.spaceId, name: space?.name ?? null }, undefined, {
      ...result,
    });
}
