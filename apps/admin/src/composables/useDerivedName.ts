import { technicalName } from '@manablox/core';
import { ref } from 'vue';

/**
 * A technical name that follows a label until edited by hand. A trailing hyphen is kept
 * while typing and trimmed on blur.
 */
export interface DerivedNameOptions {
  read: () => string;
  write: (value: string) => void;
  /** Defaults to `technicalName`. */
  derive?: (value: string, options?: { final?: boolean }) => string;
  /** Whether the name still follows the label. Defaults to `!touched`. */
  follows?: (touched: boolean) => boolean;
  /** Start detached, e.g. for an existing row. */
  detached?: boolean;
}

export function useDerivedName(options: DerivedNameOptions) {
  const touched = ref(options.detached ?? false);
  const derive = options.derive ?? technicalName;
  const follows = () => (options.follows ?? ((edited) => !edited))(touched.value);

  return {
    touched,
    follows,
    onLabelInput(value: string): void {
      if (follows()) options.write(derive(value));
    },
    onNameInput(value: string): void {
      touched.value = true;
      options.write(derive(value));
    },
    onNameBlur(): void {
      options.write(derive(options.read(), { final: true }));
    },
    /** Re-attaches, for a form reused for another row. */
    reset(detached = false): void {
      touched.value = detached;
    },
  };
}
