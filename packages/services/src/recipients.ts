import { grantsCover, type Permission, permissionsFor } from '@manablox/core';
import type { Repositories, UserRow } from '@manablox/db';

/** Members whose role grants a permission, plus superadmins; banned accounts excluded. */
export async function usersHolding(
  repos: Repositories,
  spaceId: string,
  permission: Permission,
  typeId: string | null = null,
): Promise<UserRow[]> {
  const [members, customRoles, superadmins] = await Promise.all([
    repos.users.listMembersBySpace(spaceId),
    repos.roles.listBySpace(spaceId),
    repos.users.listByRole('superadmin'),
  ]);
  const grantsByRole = new Map<string, readonly string[]>();
  for (const role of customRoles) grantsByRole.set(role.machineName, role.permissions);

  const out = new Map<string, UserRow>();
  for (const user of superadmins) if (!user.banned) out.set(user.id, user);
  for (const { role, user } of members) {
    if (user.banned || out.has(user.id)) continue;
    const grants = grantsByRole.get(role) ?? permissionsFor(role);
    if (grantsCover(grants, permission, typeId)) out.set(user.id, user);
  }
  return [...out.values()];
}
