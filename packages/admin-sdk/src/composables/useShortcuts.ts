import { type MaybeRefOrGetter, onScopeDispose } from 'vue';
import { registerShortcuts, type Shortcut } from '../lib/shortcuts';

export interface ShortcutsOptions {
  /** Help dialog section. */
  group?: string;
  /** Lower sorts first; the shell uses 90 and above. */
  order?: number;
}

/**
 * Binds shortcuts and lists them in the help dialog while the component is mounted.
 *
 * ```ts
 * useShortcuts(() => [
 *   { keys: 'mod+s', label: 'Save', whileTyping: true, run: () => void save() },
 *   { keys: 'n', label: 'New menu', enabled: () => canWrite.value, run: () => (creating.value = true) },
 * ], { group: 'Menus' });
 * ```
 */
export function useShortcuts(
  shortcuts: MaybeRefOrGetter<Shortcut[]>,
  options: ShortcutsOptions = {},
): void {
  const release = registerShortcuts({
    shortcuts,
    group: options.group ?? 'This page',
    order: options.order ?? 0,
  });
  onScopeDispose(release);
}
