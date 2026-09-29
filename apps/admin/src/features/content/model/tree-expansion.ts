import { toggleInSet } from '@manablox/admin-sdk/lib/collections';
import { ref } from 'vue';

/**
 * Open content tree nodes, module-scoped so every tree level and both panel mounts share
 * it. Persisted per space and locale; stale ids are harmless, so nothing prunes them.
 */
const open = ref<Set<string>>(new Set());
/** The current storage key; `null` before a space is known. */
let storageKey: string | null = null;

function keyFor(spaceId: string, locale: string): string {
  return `manablox.tree.open.${spaceId}.${locale}`;
}

/** Storage can throw, e.g. in a private window. */
function read(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function write(): void {
  if (!storageKey) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify([...open.value]));
  } catch {
    // Full or blocked storage only loses the open state.
  }
}

export const expansion = {
  open,
  /** Switches to one space and locale's stored set. */
  scope(spaceId: string | null, locale: string): void {
    const next = spaceId ? keyFor(spaceId, locale) : null;
    if (next === storageKey) return;
    storageKey = next;
    open.value = next ? read(next) : new Set();
  },
  isOpen(id: string): boolean {
    return open.value.has(id);
  },
  toggle(id: string): void {
    open.value = toggleInSet(open.value, id);
    write();
  },
  /** Opens several nodes at once, e.g. the edited document's ancestors. */
  expand(ids: readonly string[]): void {
    if (!ids.length || ids.every((id) => open.value.has(id))) return;
    open.value = new Set([...open.value, ...ids]);
    write();
  },
};
