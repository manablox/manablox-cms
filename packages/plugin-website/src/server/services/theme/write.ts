import { ManabloxError, type ResolvedScope, scopeSpaceId } from '@manablox/core';
import { websiteRepos } from '../../db/index.js';
import { assertDesignFeatures } from '../design/rules.js';
import type { ThemeContext } from './context.js';
import type { PlannedDesign, ThemeImportReport } from './plan.js';

/** Writes the planned designs as drafts in one transaction, with one audit entry. */
export async function writeImport(
  ctx: ThemeContext,
  scope: string | ResolvedScope,
  report: ThemeImportReport,
  planned: PlannedDesign[],
  actorId: string | null,
): Promise<void> {
  const spaceId = scopeSpaceId(scope);
  const writes = planned.filter((entry) => entry.action !== 'skip');
  if (!writes.length) return;
  for (const entry of writes) {
    const current = await websiteRepos(ctx.repos).designs.find(scope, entry.kind, entry.key);
    await assertDesignFeatures(
      ctx.manablox,
      spaceId,
      entry.kind,
      current?.draft ?? null,
      entry.data,
    );
  }
  await ctx.repos.transaction(async (tx) => {
    for (const entry of writes) {
      const current = await websiteRepos(tx).designs.find(scope, entry.kind, entry.key);
      const saved = current
        ? await websiteRepos(tx).designs.saveDraft(current.id, current.version, {
            draft: entry.data,
            actorId,
          })
        : await websiteRepos(tx).designs.create({
            spaceId,
            ...(typeof scope === 'string' ? {} : { environmentId: scope.environmentId }),
            kind: entry.kind,
            key: entry.key,
            draft: entry.data,
            actorId,
          });
      if (!saved) {
        throw ManabloxError.conflict('plugins.website.design.versionConflict', {
          kind: entry.kind,
          key: entry.key,
        });
      }
    }
    await ctx.audit.in(tx).record(
      'website.design.import',
      {
        id: null,
        spaceId,
        ...(typeof scope === 'string' ? {} : { environmentId: scope.environmentId }),
        label: report.name || 'Theme',
      },
      undefined,
      {
        created: writes.filter((entry) => entry.action === 'create').length,
        replaced: writes.filter((entry) => entry.action === 'replace').length,
        skipped: planned.length - writes.length,
      },
    );
  });
}
