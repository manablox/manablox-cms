import { actorRoles, allowedTypeIds, assertCan, type ContentPermission } from '@manablox/auth';
import { ManabloxError } from '@manablox/core';
import type { RpcContext } from './context.js';

// Per-type checks, completing `scoped('content:...')` once the input names the type.

/**
 * The type id a per-type grant names for `typeId`. Grants name production types; a staging
 * environment's type follows the production type of the same name.
 */
export function grantTypeId(context: RpcContext, typeId: string): string {
  const env = context.env;
  if (!env || env.production) return typeId;
  return context.manablox.contentTypes.grantTypeId(typeId);
}

/** `allowedTypeIds` in the request's environment: a staging type counts by its name's grant. */
export function allowedTypeIdsIn(
  context: RpcContext,
  spaceId: string,
  permission: ContentPermission,
): string[] | null {
  const allowed = allowedTypeIds(context.principal, spaceId, permission);
  const env = context.env;
  if (allowed === null || !env || env.production) return allowed;
  const registry = context.manablox.contentTypes;
  const out = new Set(allowed);
  for (const id of allowed) {
    const name = registry.tryGet(id)?.name;
    const staged = name ? registry.tryGetByName(name, env) : undefined;
    if (staged) out.add(staged.id);
  }
  return [...out];
}

export function assertOnType(
  context: RpcContext,
  spaceId: string,
  permission: ContentPermission,
  typeId: string,
): void {
  assertCan(context.principal, spaceId, permission, grantTypeId(context, typeId));
}

/** Narrowing roles only: the document's type must be granted. The service checks the space. */
export async function assertOnDocument(
  context: RpcContext,
  spaceId: string,
  permission: ContentPermission,
  id: string,
): Promise<void> {
  // Only narrowing roles cost an extra read.
  if (allowedTypeIds(context.principal, spaceId, permission) === null) return;
  const row = await context.content.stored(context.env ?? spaceId, id);
  if (!row) throw ManabloxError.notFound('content.notFound', { id });
  assertOnType(context, spaceId, permission, row.typeId);
}

/** The filter narrowed to the types the caller may read; `null` when that leaves none. */
export function narrowToAllowed<T extends { spaceId: string; typeIds?: string[] | undefined }>(
  context: RpcContext,
  filter: T,
): T | null {
  const allowed = allowedTypeIdsIn(context, filter.spaceId, 'content:read');
  if (allowed === null) return filter;
  const typeIds = filter.typeIds?.length
    ? filter.typeIds.filter((typeId) => allowed.includes(typeId))
    : allowed;
  return typeIds.length ? { ...filter, typeIds } : null;
}

export function toActor(context: { principal: unknown }, spaceId: string) {
  const principal = context.principal as { userId: string } | null;
  if (!principal) return null;
  return { userId: principal.userId, roles: actorRoles(principal as never, spaceId) };
}
