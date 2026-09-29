import { useSpaceStore } from '@manablox/admin-sdk';
import { computed } from 'vue';

/** The space's document types and locales as chip options, for trigger scopes. */
export function useScopeOptions() {
  const spaces = useSpaceStore();
  const types = computed(() =>
    spaces.contentTypes
      .filter((type) => type.kind !== 'block')
      .map((type) => ({ value: type.id, label: type.label })),
  );
  const locales = computed(() =>
    (spaces.current?.locales ?? []).map((locale) => ({ value: locale, label: locale })),
  );
  return { types, locales };
}
