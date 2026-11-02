import { useSessionStore, useSpaceStore } from '@manablox/admin-sdk';
import { computed } from 'vue';
import type { AiCapability, AiProviderRef } from '../sdk';
import type { AiWand } from './admin-api';
import { useAiAvailable } from './queries';

/** Whether to show a wand: the space has a capable provider and the user may use it. */
export function useWand(capability: AiCapability): AiWand {
  const spaces = useSpaceStore();
  const session = useSessionStore();
  const { data } = useAiAvailable();

  const kinds = computed<AiProviderRef[]>(() => data.value?.[capability] ?? []);
  return {
    kinds,
    spaceId: computed(() => spaces.currentId),
    enabled: computed(() => kinds.value.length > 0 && session.can('ai:use', spaces.currentId)),
  };
}
