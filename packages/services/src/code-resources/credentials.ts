import { auditor, type CredentialDefinition } from '@manablox/core';
import type { CredentialRow, CredentialWriteData, Repositories, SpaceRow } from '@manablox/db';
import type { SpaceRows } from './plan.js';
import { reconcile } from './reconcile.js';
import {
  CODE_ACTOR,
  type CodeResourceServices,
  codeCredentialId,
  entry,
  type SyncChange,
  type SyncOptions,
} from './shared.js';

/** Vault slots; shared by the space's environments, so synced with production. */
export function syncCredentials(
  { repos, services }: { repos: Repositories; services: CodeResourceServices },
  space: SpaceRow,
  rows: SpaceRows,
  declared: CredentialDefinition[],
  options: SyncOptions,
): Promise<SyncChange[]> {
  return reconcile<
    CredentialDefinition,
    CredentialRow,
    Omit<CredentialWriteData, 'id' | 'spaceId'>
  >(space, declared, options, {
    kind: 'credential',
    slug: (definition) => definition.slug,
    id: (definition) => codeCredentialId(space.id, definition.slug),
    key: (definition) => definition.slug,
    rowKey: (row) => row.slug,
    taken: 'a credential of this space already has that slug',
    rows: rows.credentials,
    audit: {
      create: 'credential.create',
      update: 'credential.update',
      auditor: auditor(repos, 'credential', (row: CredentialRow) => row.name, {
        actor: CODE_ACTOR,
      }),
    },
    create: (id, fields) => repos.credentials.create({ id, spaceId: space.id, ...fields }),
    update: (id, fields) => repos.credentials.update(id, fields),
    prepare: (definition, current) => {
      // A slot declared without values keeps what an operator filled in.
      const stale =
        definition.values !== null &&
        (!current || !services.credentials.matchesFields(current, definition.values));
      const sealed =
        stale && definition.values
          ? services.credentials.sealFields(definition.credentialKind, definition.values)
          : null;

      const desired = {
        name: definition.name,
        slug: definition.slug,
        kind: definition.credentialKind,
        provider: definition.provider,
        source: 'code' as const,
        sourceRef: definition.sourceRef ?? null,
        ...(sealed ?? {}),
      };

      return {
        desired,
        ...(sealed ? {} : { reason: 'no values declared; slot is empty' }),
        same: (row) =>
          row.name === desired.name &&
          row.kind === desired.kind &&
          row.provider === desired.provider &&
          row.source === 'code' &&
          row.sourceRef === desired.sourceRef &&
          !stale,
      };
    },
  });
}

/** Credentials are released, never deleted: they may hold operator-entered secrets. */
export async function pruneCredentials(
  { repos }: { repos: Repositories },
  space: SpaceRow,
  rows: SpaceRows,
  options: SyncOptions,
): Promise<SyncChange[]> {
  const changes: SyncChange[] = [];
  const credentialSlugs = new Set(rows.declared.credentials.map((declaration) => declaration.slug));
  // Shared by the space's environments, so pruned once, with production.
  const credentials = rows.environment.kind === 'production' ? rows.credentials : [];
  for (const row of credentials) {
    if (row.source !== 'code' || credentialSlugs.has(row.slug)) continue;
    changes.push(entry('credential', row.slug, space, 'released'));
    if (options.dryRun) continue;
    await repos.credentials.update(row.id, { source: 'runtime', sourceRef: null });
  }
  return changes;
}
