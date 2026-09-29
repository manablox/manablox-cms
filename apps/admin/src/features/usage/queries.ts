import { api } from '@manablox/admin-sdk/lib/api';
import { keys } from '@manablox/admin-sdk/lib/keys';
import { useSpaceQuery } from '@manablox/admin-sdk/lib/space-query';
import { useQuery } from '@tanstack/vue-query';

export type { UsageOverview } from '@manablox/admin-sdk/lib/api-types';

/** Counters move about once a minute. */
const STALE_MS = 30_000;

/** The current space's usage, with the group and instance limits over it. */
export function useSpaceUsage() {
  return useSpaceQuery(
    (space) => keys.usage.space(space),
    (space) => api.usage.space({ spaceId: space }),
    { staleTime: STALE_MS },
  );
}

/** The instance's usage and every space's; superadmins only. */
export function useInstanceUsage() {
  return useQuery({
    queryKey: keys.usage.instance(),
    queryFn: () => api.usage.instance(),
    staleTime: STALE_MS,
  });
}
