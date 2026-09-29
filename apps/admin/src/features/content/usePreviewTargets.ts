import type { AdminPreviewTarget, AdminSlotProps } from '@manablox/admin-plugin';
import { computed, shallowRef } from 'vue';
import { type SlotItem, useSlotItems } from '~/lib/plugins/registry';

type TargetProps = AdminSlotProps['content.preview.target'];

/**
 * The visual editor's frame when a plugin entry takes it over. Entries may frame their own
 * page; until each has answered (`decided`), nothing is framed. `target` is the first entry's
 * frame that took over, in slot order.
 */
export function usePreviewTargets(base: () => Omit<TargetProps, 'preview'>) {
  const targetSlot = useSlotItems('content.preview.target');
  const targetItems = computed(() =>
    targetSlot.value.filter((item) => !item.entry.when || item.entry.when(targetProps())),
  );
  const targets = shallowRef<ReadonlyMap<string, AdminPreviewTarget | null>>(new Map());
  const setters = new Map<string, (target: AdminPreviewTarget | null) => void>();
  function setterFor(key: string) {
    let setter = setters.get(key);
    if (!setter) {
      setter = (target) => {
        targets.value = new Map([...targets.value, [key, target]]);
      };
      setters.set(key, setter);
    }
    return setter;
  }
  const targetProps = (): TargetProps => ({ ...base(), preview: { setTarget: () => {} } });
  const targetPropsOf = (item: SlotItem<'content.preview.target'>): TargetProps => ({
    ...targetProps(),
    preview: { setTarget: setterFor(item.key) },
  });
  const decided = computed(() => targetItems.value.every((item) => targets.value.has(item.key)));
  const target = computed(() => {
    for (const item of targetItems.value) {
      const own = targets.value.get(item.key);
      if (own) return own;
    }
    return null;
  });

  return { targetProps, targetPropsOf, decided, target };
}
