import { type MaybeRefOrGetter, onBeforeUnmount, toValue, watchEffect } from 'vue';
import { useBreadcrumbStore } from '../stores/breadcrumb';

/** Sets the breadcrumb's last crumb reactively while the page is mounted. */
export function useBreadcrumb(leaf: MaybeRefOrGetter<string | null | undefined>): void {
  const store = useBreadcrumbStore();
  watchEffect(() => {
    store.leaf = toValue(leaf) ?? null;
  });
  onBeforeUnmount(() => {
    store.leaf = null;
  });
}
