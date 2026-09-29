import { type MaybeRefOrGetter, onBeforeUnmount, onMounted, toValue } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { confirm } from '../lib/confirm';

/** Confirms before leaving with unsaved changes: a dialog in-app, the native prompt on unload. */
export function useUnsavedGuard(
  isDirty: () => boolean,
  what: MaybeRefOrGetter<string> = 'This document',
): void {
  onBeforeRouteLeave(async () => {
    if (!isDirty()) return true;
    return confirm({
      title: 'Leave without saving?',
      message: `${toValue(what)} has unsaved changes. Leaving now discards them.`,
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      danger: true,
    });
  });

  function onBeforeUnload(event: BeforeUnloadEvent) {
    if (isDirty()) event.preventDefault();
  }
  onMounted(() => window.addEventListener('beforeunload', onBeforeUnload));
  onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload));
}
