import { focusFirstFieldSoon } from '@manablox/admin-sdk/lib/focus';
import { type MaybeRefOrGetter, nextTick, type Ref, toValue, watch } from 'vue';

/** Focuses the first field under `root` while `when` is true, again whenever `root` changes. */
export function useFocusFirstField(
  root: Readonly<Ref<HTMLElement | null | undefined>>,
  when: MaybeRefOrGetter<boolean>,
): void {
  watch(
    () => (toValue(when) ? root.value : null),
    async (element) => {
      if (!element) return;
      await nextTick();
      focusFirstFieldSoon(element);
    },
    { immediate: true, flush: 'post' },
  );
}
