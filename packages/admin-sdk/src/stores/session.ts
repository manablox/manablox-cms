import type { FeatureKey } from '@manablox/core';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '../lib/api';
import type { Me } from '../lib/api-types';
import { auth } from '../lib/auth';
import { type FeatureState, featureState } from '../lib/features';

/** Controls can change at runtime; `revalidate` refetches at most this often. */
const REVALIDATE_MS = 60_000;

export type { Me } from '../lib/api-types';

export const useSessionStore = defineStore('session', () => {
  const me = ref<Me | null>(null);
  const loading = ref(true);

  const isAuthenticated = computed(() => me.value !== null);
  const isSuperadmin = computed(() => me.value?.role === 'superadmin');

  let fetchedAt = 0;

  async function refresh(): Promise<void> {
    loading.value = true;
    try {
      me.value = await api.users.me();
      fetchedAt = Date.now();
    } catch {
      me.value = null;
    } finally {
      loading.value = false;
    }
  }

  /** Refetches in the background, keeping the current account on failure; `force` skips the wait. */
  async function revalidate(force = false): Promise<void> {
    if (!me.value || (!force && Date.now() - fetchedAt < REVALIDATE_MS)) return;
    fetchedAt = Date.now();
    try {
      const next = await api.users.me();
      if (next) me.value = next;
    } catch {
      // The next focus tries again.
    }
  }

  /** `twoFactor` when a second step is due before the session exists. */
  async function signIn(email: string, password: string): Promise<'signedIn' | 'twoFactor'> {
    const result = await auth.signIn(email, password);
    if ('twoFactorRedirect' in result) return 'twoFactor';
    await refresh();
    return 'signedIn';
  }

  async function signUp(email: string, password: string, name: string): Promise<void> {
    await auth.signUp(email, password, name);
    await refresh();
  }

  async function signOut(): Promise<void> {
    await auth.signOut();
    me.value = null;
  }

  /** Role held in a space, for hiding actions the server would reject. */
  function roleIn(spaceId: string | null): string | null {
    if (!me.value || !spaceId) return null;
    if (me.value.role === 'superadmin') return 'owner';
    return me.value.spaces[spaceId] ?? null;
  }

  /** UI-only permission check; with `typeId` for one content type, else for any. */
  function can(permission: string, spaceId: string | null, typeId?: string | null): boolean {
    if (!me.value || !spaceId) return false;
    if (me.value.role === 'superadmin') return true;
    const grants = me.value.permissions[spaceId] ?? [];
    if (grants.includes(permission)) return true;
    if (!permission.startsWith('content:')) return false;
    if (typeId) return grants.includes(`${permission}:${typeId}`);
    return grants.some((grant) => grant.startsWith(`${permission}:`));
  }

  /** A control-set feature in a space, or the instance with `null`. */
  function feature(key: FeatureKey, spaceId: string | null): FeatureState {
    return featureState(me.value, key, spaceId);
  }

  return {
    me,
    loading,
    isAuthenticated,
    isSuperadmin,
    refresh,
    revalidate,
    signIn,
    signUp,
    signOut,
    roleIn,
    can,
    feature,
  };
});
