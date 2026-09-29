import { api } from '@manablox/admin-sdk/lib/api';
import { invalidate } from '@manablox/admin-sdk/lib/invalidate';
import { keys } from '@manablox/admin-sdk/lib/keys';
import { type SpaceRef, useSpaceQuery } from '@manablox/admin-sdk/lib/space-query';
import { spaceWrites } from '@manablox/admin-sdk/lib/writes';
import { useQuery } from '@tanstack/vue-query';

export type { Role } from '@manablox/admin-sdk/lib/api-types';

export interface RoleInput {
  name: string;
  machineName: string;
  description: string | null;
  permissions: string[];
}

/** A space's roles, built-in first; disabled without a space. */
export function useRoles(spaceId?: SpaceRef) {
  return useSpaceQuery(keys.roles.all, (id) => api.roles.list({ spaceId: id }), { spaceId });
}

/** The server's permission catalogue. */
export function useRoleCatalog() {
  return useQuery({
    queryKey: keys.roles.catalog(),
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: () => api.roles.catalog(),
  });
}

const write = spaceWrites(invalidate.roles);

/** Role writes, each with its invalidation. */
export const roles = {
  create: write.withSpace((spaceId: string, input: RoleInput) =>
    api.roles.create({ spaceId, ...input }),
  ),
  update: write.withSpace((spaceId: string, id: string, input: RoleInput) =>
    api.roles.update({ spaceId, id, ...input }),
  ),
  remove: write.withSpace(async (spaceId: string, id: string) => {
    await api.roles.delete({ spaceId, id });
  }),
};
