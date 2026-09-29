import { useMediaQuery } from '@vueuse/core';
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

/** Small-screen drawer state. `isWide` is Tailwind's `lg`. */
export const useUiStore = defineStore('ui', () => {
  const isWide = useMediaQuery('(min-width: 64rem)');
  const navOpen = ref(false);
  const panelOpen = ref(false);

  function closeDrawers(): void {
    navOpen.value = false;
    panelOpen.value = false;
  }

  // An open drawer would linger as an overlay on a wide screen.
  watch(isWide, (wide) => {
    if (wide) closeDrawers();
  });

  return { isWide, navOpen, panelOpen, closeDrawers };
});
