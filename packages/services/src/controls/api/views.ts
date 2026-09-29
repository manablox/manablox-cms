import type {
  SpaceApiHostRow,
  SpaceCounts,
  SpaceGroupRow,
  SpaceRow,
  UserActivityRow,
} from '@manablox/db';
import { API_HOST_SOURCE } from '../../api-host.service.js';
import { hostSources } from '../../data/registry.js';
import type { ControlApiContext } from './context.js';
import type { ControlGroupView, ControlSpaceView, ControlUserView } from './types.js';

const EMPTY_COUNTS: SpaceCounts = { documents: 0, contentTypes: 0, members: 0, assets: 0 };

export async function groupView(
  ctx: ControlApiContext,
  group: SpaceGroupRow,
): Promise<ControlGroupView> {
  return {
    id: group.id,
    externalId: group.externalId,
    name: group.name,
    spaceIds: await ctx.repos.spaceGroups.listSpaceIds(group.id),
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  };
}

export async function spaceView(
  ctx: ControlApiContext,
  space: SpaceRow,
  groups: Map<string, SpaceGroupRow>,
  counts: Map<string, SpaceCounts>,
  apiHosts?: SpaceApiHostRow[],
): Promise<ControlSpaceView> {
  const group = space.groupId ? groups.get(space.groupId) : undefined;
  const hosts = (
    await Promise.all(
      hostSources(ctx.manablox).map(async (source) =>
        source === API_HOST_SOURCE || !source.listBySpace
          ? []
          : (
              await source.listBySpace(ctx.repos, space.id)
            ).map((row) => ({
              hostname: row.hostname,
              locale: null,
              isPrimary: false,
              ...source.viewFields?.(row),
              verified: row.verifiedAt !== null,
              verificationToken: row.verifiedAt ? null : row.verificationToken,
            })),
      ),
    )
  ).flat();
  const api = apiHosts ?? (await ctx.repos.spaceApiHosts.listBySpace(space.id));
  return {
    id: space.id,
    name: space.name,
    machineName: space.machineName,
    description: space.description,
    url: space.url,
    defaultLocale: space.defaultLocale,
    locales: space.locales,
    status: space.importStatus ?? 'ready',
    group: group ? { id: group.id, externalId: group.externalId, name: group.name } : null,
    hosts,
    apiHosts: api.map((host) => ({
      hostname: host.hostname,
      verified: host.verifiedAt !== null,
      verificationToken: host.verifiedAt ? null : host.verificationToken,
      createdAt: host.createdAt.toISOString(),
    })),
    counts: counts.get(space.id) ?? { ...EMPTY_COUNTS },
    createdAt: space.createdAt.toISOString(),
    updatedAt: space.updatedAt.toISOString(),
  };
}

export function userView(user: UserActivityRow): ControlUserView {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    banned: user.banned,
    memberships: user.memberships,
    lastSignInAt: user.lastSignInAt ? user.lastSignInAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
  };
}
