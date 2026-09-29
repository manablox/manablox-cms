import type { Ref } from 'vue';
import { useShortcuts } from './useShortcuts';

/** `/` focuses and selects the page's search input. */
export function useSearchShortcut(
  input: Ref<HTMLInputElement | null>,
  label = 'Search this page',
): void {
  useShortcuts(() => [
    {
      keys: '/',
      label,
      enabled: () => input.value !== null,
      run: () => {
        input.value?.focus();
        input.value?.select();
      },
    },
  ]);
}
