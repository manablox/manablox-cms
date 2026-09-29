import {
  type Auditor,
  type AuditSink,
  auditor,
  type ErrorKey,
  inScope,
  ManabloxError,
  type ResolvedScope,
  type Scope,
} from '@manablox/core';
import type { ContentRow, CredentialRow, Repositories } from '@manablox/db';

/**
 * Exists-in-scope check: the row's space, and its environment when `scope` names one. Another
 * space's or environment's row is not found rather than forbidden.
 */
export function requireInSpace<T extends { spaceId: string; environmentId?: string | null }>(
  row: T | null | undefined,
  scope: Scope,
  key: ErrorKey,
  params: Record<string, unknown>,
): T {
  if (!row || !inScope(row, scope)) throw ManabloxError.notFound(key, params);
  return row;
}

/**
 * A scope that knows whether it is production, for type lookups and cache tags; a space id
 * alone stays as it is and means production.
 */
export async function resolveScope(
  repos: Pick<Repositories, 'environments'>,
  scope: Scope,
): Promise<string | ResolvedScope> {
  if (typeof scope === 'string') return scope;
  if ('production' in scope && 'machineName' in scope) return scope as ResolvedScope;
  const resolved = await repos.environments.resolve(scope);
  if (!resolved) {
    throw ManabloxError.notFound('environment.notFound', { environmentId: scope.environmentId });
  }
  return resolved;
}

/** The `spaceId` and `environmentId` a hook context carries for a scope. */
export function hookScope(scope: Scope): { spaceId: string; environmentId?: string } {
  return typeof scope === 'string'
    ? { spaceId: scope }
    : { spaceId: scope.spaceId, environmentId: scope.environmentId };
}

/** What control events about an environment's row carry: its environment id and machine name. */
export async function environmentPayload(
  repos: Pick<Repositories, 'environments'>,
  row: { spaceId: string; environmentId: string },
): Promise<{ environmentId: string; environment: string | null }> {
  const resolved = await repos.environments.resolve({
    spaceId: row.spaceId,
    environmentId: row.environmentId,
  });
  return { environmentId: row.environmentId, environment: resolved?.machineName ?? null };
}

/** Whether a scope is a staging environment. */
export async function isStaging(
  repos: Pick<Repositories, 'environments'>,
  scope: Scope,
): Promise<boolean> {
  const resolved = await resolveScope(repos, scope);
  return typeof resolved !== 'string' && !resolved.production;
}

/** Document entries carry the type and locale. */
export function contentAuditor(sink: AuditSink): Auditor<ContentRow> {
  return auditor(sink, 'content', (row: ContentRow) => row.title, {
    meta: (row) => ({ typeId: row.typeId, locale: row.locale }),
  });
}

/** Credential entries carry the kind, never values. */
export function credentialAuditor(sink: AuditSink): Auditor<CredentialRow> {
  return auditor(sink, 'credential', (row: CredentialRow) => row.name, {
    meta: (row) => ({ kind: row.kind, provider: row.provider }),
  });
}
