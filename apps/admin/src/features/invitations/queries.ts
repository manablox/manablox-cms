import { api } from '@manablox/admin-sdk/lib/api';
import { invalidate } from '@manablox/admin-sdk/lib/invalidate';
import { keys } from '@manablox/admin-sdk/lib/keys';
import { useQuery } from '@tanstack/vue-query';
import { computed, type MaybeRefOrGetter, toValue } from 'vue';

type CreateInput = Parameters<typeof api.invitations.create>[0];
export type Invitation = Awaited<ReturnType<typeof api.invitations.list>>[number];
export type InvitationPreview = Awaited<ReturnType<typeof api.invitations.preview>>;

/** A space's invitations, or every one with `null` (superadmins). */
export function useInvitations(spaceId: MaybeRefOrGetter<string | null>) {
  return useQuery({
    queryKey: computed(() => keys.invitations.list(toValue(spaceId))),
    queryFn: () => {
      const id = toValue(spaceId);
      return api.invitations.list(id ? { spaceId: id } : {});
    },
  });
}

/** Invitation writes, each with its invalidation; `preview` and `accept` work signed out. */
export const invitations = {
  async create(input: CreateInput) {
    const issued = await api.invitations.create(input);
    invalidate.invitations();
    return issued;
  },
  async resend(id: string) {
    const issued = await api.invitations.resend({ id });
    invalidate.invitations();
    return issued;
  },
  async revoke(id: string) {
    await api.invitations.revoke({ id });
    invalidate.invitations();
  },
  preview(token: string) {
    return api.invitations.preview({ token });
  },
  /** With `account`, a new account; without, the signed-in one. */
  async accept(token: string, account?: { name: string; password: string }) {
    const result = await api.invitations.accept({ token, ...account });
    return result;
  },
};
