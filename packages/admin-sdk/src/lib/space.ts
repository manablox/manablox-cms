import type { FeatureKey } from '@manablox/core';
import { type ComputedRef, computed, type MaybeRefOrGetter, toValue } from 'vue';
import { useSessionStore } from '../stores/session';
import { useSpaceStore } from '../stores/space';
import type { FeatureState } from './features';

/** The current space id; throws without one, so call it inside a write. */
export function requireSpace(): string {
  const spaceId = useSpaceStore().currentId;
  if (!spaceId) throw new Error('No space selected');
  return spaceId;
}

/** Whether the user holds `permission` in the current space, optionally for one content type. */
export function useCan(
  permission: MaybeRefOrGetter<string>,
  typeId?: MaybeRefOrGetter<string | null | undefined>,
): ComputedRef<boolean> {
  const session = useSessionStore();
  const spaces = useSpaceStore();
  return computed(() => session.can(toValue(permission), spaces.currentId, toValue(typeId)));
}

/** A control-set feature in the current space (the instance without one). */
export function useFeature(key: MaybeRefOrGetter<FeatureKey>): ComputedRef<FeatureState> {
  const session = useSessionStore();
  const spaces = useSpaceStore();
  return computed(() => session.feature(toValue(key), spaces.currentId));
}
