import { defineStore } from 'pinia';
import { ref } from 'vue';

/** The topbar breadcrumb's last crumb, set by the page via `useBreadcrumbStore`. */
export const useBreadcrumbStore = defineStore('breadcrumb', () => {
  const leaf = ref<string | null>(null);
  return { leaf };
});
