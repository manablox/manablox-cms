import {
  type AuditActor,
  allPermissions,
  type ContentPermission,
  grantsCover,
  intersectGrants,
  ManabloxError,
  type Permission,
  permissionsFor,
  type SpaceRole,
  typesCoveredBy,
} from '@manablox/core';

export {
  ALL_PERMISSIONS,
  allPermissions,
  BUILT_IN_ROLES,
  type BuiltInRole,
  CONTENT_ACTIONS,
  type ContentAction,
  type ContentPermission,
  type Grant,
  grantsCover,
  intersectGrants,
  isBuiltInRole,
  normaliseGrants,
  PERMISSION_GROUPS,
  type Permission,
  type PermissionGroup,
  parseGrant,
  permissionGroups,
  permissionsFor,
  type SpaceRole,
  typesCoveredBy,
} from '@manablox/core';

export interface Principal {
  userId: string;
  email: string;
  /** Instance-wide role; `superadmin` short-circuits every space check. */
  role: string;
  /** Space id -> role name. */
  spaces: Record<string, SpaceRole>;
  /** Space id -> resolved grants; absent for built-in roles. */
  permissions?: Record<string, readonly string[]>;
  /** True when authenticated with an API key. */
  viaApiKey?: boolean;
  /** For the audit log. */
  apiKeyId?: string | null;
  apiKeyName?: string | null;
  /** API key space restriction; `null` for none. Binds a superadmin too. */
  allowedSpaceIds?: string[] | null;
  /** API key environment restriction by environment id; `null` for none. */
  allowedEnvironmentIds?: string[] | null;
  /** API key grant restriction; `null` for none. Binds a superadmin too. */
  allowedGrants?: readonly string[] | null;
  /** Signed in, but the two-factor policy asks for enrolment first; holds no grants. */
  twoFactorPending?: boolean;
}

/** The principal as the audit log records it; anonymous requests act as the system. */
export function auditActorFor(
  principal: Principal | null,
  request?: { headers: Headers; requestId?: string | null | undefined },
): AuditActor {
  const detail: Record<string, unknown> = {};
  if (request) {
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip');
    if (ip) detail.ip = ip;
    const userAgent = request.headers.get('user-agent');
    if (userAgent) detail.userAgent = userAgent.slice(0, 300);
    if (request.requestId) detail.requestId = request.requestId;
  }
  if (!principal) return { kind: 'system', id: null, label: 'anonymous', detail };
  if (principal.viaApiKey) {
    detail.apiKeyId = principal.apiKeyId ?? null;
    detail.apiKeyName = principal.apiKeyName ?? null;
    return { kind: 'apikey', id: principal.userId, label: principal.email, detail };
  }
  return { kind: 'user', id: principal.userId, label: principal.email, detail };
}

/** The grants a principal's role gives in a space. */
export function grantsIn(principal: Principal, spaceId: string): readonly string[] {
  const role = principal.spaces[spaceId];
  if (!role) return [];
  return principal.permissions?.[spaceId] ?? permissionsFor(role);
}

/** The role's grants in a space, narrowed by any API key restriction. */
export function effectiveGrants(principal: Principal, spaceId: string): readonly string[] {
  if (principal.allowedSpaceIds && !principal.allowedSpaceIds.includes(spaceId)) return [];
  const held = principal.role === 'superadmin' ? allPermissions() : grantsIn(principal, spaceId);
  return principal.allowedGrants ? intersectGrants(held, principal.allowedGrants) : held;
}

export function can(
  principal: Principal | null,
  spaceId: string | null,
  permission: Permission,
  typeId?: string | null,
): boolean {
  if (!principal) return false;
  // Before the superadmin short-circuit: restrictions bind superadmins too.
  if (principal.allowedSpaceIds && (!spaceId || !principal.allowedSpaceIds.includes(spaceId))) {
    return false;
  }
  if (principal.allowedGrants && !grantsCover(principal.allowedGrants, permission, typeId)) {
    return false;
  }
  if (principal.role === 'superadmin') return true;
  if (!spaceId) return false;
  return grantsCover(grantsIn(principal, spaceId), permission, typeId);
}

export function assertCan(
  principal: Principal | null,
  spaceId: string | null,
  permission: Permission,
  typeId?: string | null,
): void {
  if (can(principal, spaceId, permission, typeId)) return;
  if (!principal) throw ManabloxError.unauthorized();
  throw ManabloxError.forbidden('auth.forbidden', {
    permission,
    spaceId,
    ...(typeId ? { typeId } : {}),
  });
}

/** Requires an instance-wide superadmin; a space-restricted key never is one. */
export function assertSuperadmin(principal: Principal | null): asserts principal is Principal {
  if (!principal) throw ManabloxError.unauthorized();
  if (principal.role !== 'superadmin' || principal.allowedSpaceIds) {
    throw ManabloxError.forbidden('auth.superadminRequired');
  }
}

/** Content types a principal may act on in a space, or `null` for all. */
export function allowedTypeIds(
  principal: Principal | null,
  spaceId: string,
  permission: ContentPermission,
): string[] | null {
  if (!principal) return [];
  if (principal.role === 'superadmin' && !principal.allowedGrants) return null;
  return typesCoveredBy(effectiveGrants(principal, spaceId), permission);
}

/** Roles used by field-level `readRoles`/`writeRoles` checks. */
export function actorRoles(principal: Principal | null, spaceId: string | null): string[] {
  if (!principal) return [];
  const roles = [principal.role];
  if (spaceId && principal.spaces[spaceId]) roles.push(principal.spaces[spaceId]);
  return roles;
}
