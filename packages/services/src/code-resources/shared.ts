import { ManabloxError, sameValue, TEMPLATE_BLOCKS_FIELD } from '@manablox/core';
import { stableId } from '@manablox/core/node';
import type { ContentRow, SpaceEnvironmentRow, SpaceRow } from '@manablox/db';
import type { ContentService } from '../content/service.js';
import type { CredentialService } from '../credentials/service.js';

export const CODE_ACTOR = { kind: 'system', id: null, label: 'Code resources' } as const;

export interface SyncOptions {
  /** Only these spaces. Every space of the instance when absent. */
  spaceIds?: string[] | undefined;
  /** Delete undeclared code rows instead of disabling them. */
  prune?: boolean | undefined;
  /** Report changes without writing. */
  dryRun?: boolean | undefined;
  /** Actor recorded on template documents. */
  actorId?: string | null | undefined;
}

export type SyncAction =
  | 'created'
  | 'updated'
  | 'unchanged'
  | 'disabled'
  | 'released'
  | 'deleted'
  | 'skipped';

/** One change the sync made or would make. */
export interface SyncChange {
  /** `credential`, `template`, or the resource kind that reconciled it. */
  kind: string;
  slug: string;
  spaceId: string;
  /** The space's machine name. */
  space: string;
  /** The environment's machine name; absent for production. */
  environment?: string;
  action: SyncAction;
  /** Why it was skipped or created disabled. */
  reason?: string;
}

export interface SyncReport {
  dryRun: boolean;
  spaces: number;
  changes: SyncChange[];
}

/** Content goes through services so hooks and versions run. */
export interface CodeResourceServices {
  content: ContentService;
  credentials: CredentialService;
}

/**
 * What derived ids of environment rows are keyed on: the space id in production, the
 * environment id elsewhere. Credentials are shared and always keyed on the space.
 */
export const codeScopeKey = (space: SpaceRow, environment: SpaceEnvironmentRow): string =>
  environment.kind === 'production' ? space.id : environment.id;

export const codeCredentialId = (spaceId: string, slug: string): string =>
  stableId('credential', `${spaceId}:${slug}`);

export const codeTemplateId = (spaceId: string, slug: string, locale: string): string =>
  stableId('template', `${spaceId}:${slug}:${locale}`);

export const entry = (
  kind: string,
  slug: string,
  space: SpaceRow,
  action: SyncAction,
  reason?: string,
): SyncChange => ({
  kind,
  slug,
  spaceId: space.id,
  space: space.machineName,
  action,
  ...(reason ? { reason } : {}),
});

export const reasonOf = (error: unknown): string =>
  error instanceof ManabloxError ? error.key : String(error);

/** Whether every key of `desired` matches the row. */
export function sameShape(desired: Record<string, unknown>, row: Record<string, unknown>): boolean {
  return Object.entries(desired).every(([key, value]) => sameValue(value, row[key]));
}

export const sameBlocks = (row: ContentRow, blocks: unknown): boolean =>
  sameValue(row.fields[TEMPLATE_BLOCKS_FIELD], blocks);
