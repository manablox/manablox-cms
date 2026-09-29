import { api } from '@manablox/admin-sdk/lib/api';
import { invalidate } from '@manablox/admin-sdk/lib/invalidate';
import { keys } from '@manablox/admin-sdk/lib/keys';
import { writes } from '@manablox/admin-sdk/lib/writes';
import { useQuery } from '@tanstack/vue-query';

export function useApiKeys() {
  return useQuery({ queryKey: keys.apiKeys.all(), queryFn: () => api.users.apiKeys() });
}

const write = writes(invalidate.apiKeys);

/** Key writes, each with its invalidation. */
export const apiKeys = {
  /** Returns the secret, shown only once. */
  issue: write(
    async (name: string, spaceIds: string[], permissions: string[] | null): Promise<string> => {
      // No spaces means all of the owner's spaces; no permissions means the owner's role.
      const key = await api.users.issueApiKey({
        name,
        ...(spaceIds.length ? { spaceIds } : {}),
        ...(permissions ? { permissions } : {}),
      });
      return key.key;
    },
  ),
  revoke: write(async (id: string): Promise<void> => {
    await api.users.revokeApiKey({ id });
  }),
};
