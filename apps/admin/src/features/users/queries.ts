import { api } from '@manablox/admin-sdk/lib/api';
import { invalidate } from '@manablox/admin-sdk/lib/invalidate';
import { keys } from '@manablox/admin-sdk/lib/keys';
import { queryClient } from '@manablox/admin-sdk/lib/query-client';
import { required } from '@manablox/admin-sdk/lib/space-query';
import { useQuery } from '@tanstack/vue-query';
import { computed, type MaybeRefOrGetter, toValue } from 'vue';

export type InstanceRole = 'superadmin' | 'editor';
export const INSTANCE_ROLES: { value: InstanceRole; label: string; hint: string }[] = [
  { value: 'editor', label: 'Member', hint: 'Only what their space roles allow' },
  { value: 'superadmin', label: 'Administrator', hint: 'Every space, users and settings' },
];

/** All users, superadmin only, searchable by name or email. */
export function useUsers(search: MaybeRefOrGetter<string>) {
  return useQuery({
    queryKey: computed(() => keys.users.list(toValue(search))),
    queryFn: () => {
      const term = toValue(search);
      return api.users.list({ pagination: { limit: 100 }, ...(term ? { search: term } : {}) });
    },
  });
}

export function useUser(userId: MaybeRefOrGetter<string | null>) {
  return useQuery({
    queryKey: computed(() => keys.users.detail(toValue(userId))),
    enabled: computed(() => Boolean(toValue(userId))),
    queryFn: () => api.users.get({ userId: required(toValue(userId)) }),
  });
}

/** The caller's own account; writes refresh the session. */
export const profile = {
  update(data: { name?: string; email?: string }) {
    return api.users.updateProfile(data);
  },
  async changePassword(currentPassword: string, password: string): Promise<void> {
    await api.users.changePassword({ currentPassword, password });
  },
  /** Redeems an email confirmation link. */
  verifyEmail(token: string) {
    return api.users.verifyEmail({ token });
  },
};

/** Account writes, each with its invalidation. */
export const users = {
  /** Whether the instance has no account yet, so login offers sign-up. */
  async setupNeeded(): Promise<boolean> {
    return (await api.users.setupNeeded()).setupNeeded;
  },
  async create(input: { name: string; email: string; password: string; role: InstanceRole }) {
    const created = await api.users.create(input);
    invalidate.users();
    return created;
  },
  async update(userId: string, data: { name?: string; email?: string }) {
    const updated = await api.users.update({ userId, ...data });
    invalidate.users();
    return updated;
  },
  async setRole(userId: string, role: InstanceRole) {
    try {
      await api.users.setRole({ userId, role });
    } finally {
      // Even on failure, so the select reverts.
      invalidate.users();
    }
  },
  async setPassword(userId: string, password: string) {
    await api.users.setPassword({ userId, password });
  },
  async ban(userId: string, reason: string) {
    await api.users.ban({ userId, ...(reason ? { reason } : {}) });
    invalidate.users();
  },
  async unban(userId: string) {
    await api.users.unban({ userId });
    invalidate.users();
  },
  async revokeSessions(userId: string) {
    await api.users.revokeSessions({ userId });
  },
  async remove(userId: string) {
    await api.users.delete({ userId });
    // Removed, not invalidated: a refetch would 404.
    queryClient.removeQueries({ queryKey: keys.users.detail(userId) });
    invalidate.users();
  },
};
