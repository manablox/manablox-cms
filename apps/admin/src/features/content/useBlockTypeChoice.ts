import type { ContentTypeSummary } from '@manablox/admin-sdk/lib/api-types';
import { focusFirstFieldSoon } from '@manablox/admin-sdk/lib/focus';
import type { FieldPath } from '@manablox/live-preview';
import { nextTick, type Ref, ref, watch } from 'vue';

export interface BlockTypeChoiceOptions {
  /** The panel holding the choices and the new block's fields. */
  panel: Ref<HTMLElement | null>;
  allowedTypes: (list: FieldPath) => ContentTypeSummary[];
  insert: (list: FieldPath, index: number, typeId: string) => FieldPath;
  /** Selects the new block. */
  select: (path: FieldPath) => void;
}

/** Adding a block: a single allowed type is used at once, otherwise the panel offers a choice. */
export function useBlockTypeChoice(options: BlockTypeChoiceOptions) {
  /** Pending add request awaiting a type choice. */
  const adding = ref<{ list: FieldPath; index: number } | null>(null);

  function request(list: FieldPath, index: number): void {
    const types = options.allowedTypes(list);
    if (types.length === 1 && types[0]) {
      add(list, index, types[0].id);
      return;
    }
    adding.value = { list, index };
  }

  function add(list: FieldPath, index: number, typeId: string): void {
    const path = options.insert(list, index, typeId);
    adding.value = null;
    options.select(path);
    // Focus the new block's first field.
    void nextTick(() => {
      const fields = options.panel.value?.querySelector<HTMLElement>('[data-block-fields]');
      if (fields) focusFirstFieldSoon(fields);
    });
  }

  function cancel(): void {
    adding.value = null;
  }

  // Focus the first type choice.
  watch(adding, async (next) => {
    if (!next) return;
    await nextTick();
    options.panel.value?.querySelector<HTMLElement>('[data-add-choices] button')?.focus();
  });

  return { adding, request, add, cancel };
}
