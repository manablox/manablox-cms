import type { AdminBanner } from '@manablox/core';
import { useQuery } from '@tanstack/vue-query';
import { computed, type Ref } from 'vue';
import { api } from './api';
import type { Me } from './api-types';
import { keys } from './keys';
import { queryClient } from './query-client';

/** Instance banners, then those the current space adds. */
export function controlBanners(me: Me | null, spaceId: string | null): AdminBanner[] {
  const controls = me?.controls;
  if (!controls) return [];
  const space = spaceId ? (controls.spaces[spaceId]?.banners ?? []) : [];
  return [...controls.banners, ...space];
}

/** Why writes are refused where the viewer is; `null` while they are taken. */
export interface ReadOnlyNotice {
  scope: 'instance' | 'space';
  message: string | null;
}

export function readOnlyNotice(me: Me | null, spaceId: string | null): ReadOnlyNotice | null {
  const controls = me?.controls;
  if (!controls) return null;
  if (controls.state.status !== 'active') {
    return { scope: 'instance', message: controls.state.message };
  }
  const space = spaceId ? controls.spaces[spaceId]?.state : undefined;
  return space ? { scope: 'space', message: space.message } : null;
}

/** The suspension message, `''` without one; `null` unless the instance is suspended. */
export function suspension(me: Me | null): string | null {
  const state = me?.controls.state;
  return state?.status === 'suspended' ? (state.message ?? '') : null;
}

type AdminLinkKey = 'docs' | 'support' | 'billing' | 'upgrade';

export interface AdminLinkEntry {
  key: AdminLinkKey;
  label: string;
  icon: string;
  href: string;
}

const LINKS: readonly Omit<AdminLinkEntry, 'href'>[] = [
  { key: 'docs', label: 'Documentation', icon: 'book-open' },
  { key: 'support', label: 'Support', icon: 'message-circle' },
  { key: 'billing', label: 'Billing', icon: 'credit-card' },
  { key: 'upgrade', label: 'Upgrade', icon: 'rocket' },
];

/** The control-set links the viewer gets; billing is for superadmins. */
export function adminLinks(me: Me | null): AdminLinkEntry[] {
  const links = me?.controls.links;
  if (!links) return [];
  return LINKS.flatMap((entry) => {
    const href = links[entry.key];
    if (!href || (entry.key === 'billing' && me.role !== 'superadmin')) return [];
    return [{ ...entry, href }];
  });
}

const DISMISSED = 'banners.dismissed';
/** The server keeps this many, newest last. */
const MAX_DISMISSED = 500;

const newest = (ids: Iterable<string>) => [...new Set(ids)].slice(-MAX_DISMISSED);

/** Banner ids the user dismissed, stored with the account on the server. */
export function useDismissedBanners(userId: Ref<string | null>) {
  const queryKey = computed(() => keys.preferences.get(DISMISSED, userId.value));
  const query = useQuery({
    queryKey,
    enabled: computed(() => userId.value !== null),
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const { value } = await api.preferences.get({ key: DISMISSED });
      return value ?? [];
    },
  });
  const dismissed = computed(() => new Set(query.data.value ?? []));
  const dismiss = (id: string) => {
    if (!userId.value) return;
    const next = newest([...(query.data.value ?? []), id]);
    queryClient.setQueryData(queryKey.value, next);
    // Hidden here at once; a failed save shows it again after a reload.
    api.preferences.set({ key: DISMISSED, value: next }).catch(() => undefined);
  };
  return { dismissed, dismiss };
}
