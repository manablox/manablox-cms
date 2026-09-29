import { pathKey, useDraftForm } from '@manablox/admin-sdk/composables/useDraftForm';
import type { DraftDocument } from '@manablox/admin-sdk/features/content/model/draft';
import { content } from '@manablox/admin-sdk/features/content/queries';
import { plainClone } from '@manablox/admin-sdk/lib/clone';
import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref, watch } from 'vue';
import { onChangedElsewhere } from '~/lib/realtime';

export type { DraftDocument };

/** Edits closer together than this share one undo entry. */
export const HISTORY_BURST_MS = 400;
const HISTORY_LIMIT = 50;
/** Undo entries are whole-document snapshots, so the stack is also capped by estimated size. */
const HISTORY_BYTES = 8 * 1024 * 1024;

/** Rough byte size of a snapshot, for the history cap. */
function weigh(value: unknown): number {
  if (typeof value === 'string') return value.length + 8;
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + weigh(item), 8);
  if (value !== null && typeof value === 'object') {
    let sum = 8;
    for (const key of Object.keys(value))
      sum += key.length + weigh((value as Record<string, unknown>)[key]);
    return sum;
  }
  return 8;
}

interface HistoryEntry {
  doc: DraftDocument;
  bytes: number;
}

/** Editor state for one document: the shared form plus undo, save and conflicts. */
export const useDraftStore = defineStore('draft', () => {
  // Edits replace top-level keys or whole field values, so two levels see every change.
  const form = useDraftForm<DraftDocument>({ shallow: 2 });
  const doc = form.draft;
  const conflict = ref<{ expected: number; actual: number } | null>(null);
  /** Who saved the open document elsewhere since it was opened, from the live feed. */
  const changedElsewhere = ref<{ by: string; action: string } | null>(null);

  const undoStack = ref<HistoryEntry[]>([]);
  const redoStack = ref<HistoryEntry[]>([]);
  /** The document as it was before the current edit burst. */
  let checkpoint: DraftDocument | null = null;
  let burstTimer: ReturnType<typeof setTimeout> | null = null;
  let suppressHistory = false;

  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);

  function pushHistory(stack: HistoryEntry[], document: DraftDocument): void {
    stack.push({ doc: document, bytes: weigh(document) });
    let bytes = stack.reduce((sum, entry) => sum + entry.bytes, 0);
    while (stack.length > HISTORY_LIMIT || (bytes > HISTORY_BYTES && stack.length > 1)) {
      bytes -= stack.shift()?.bytes ?? 0;
    }
  }

  /** Ends the burst: the next edit starts a new undo entry. */
  function endBurst(): void {
    if (burstTimer) clearTimeout(burstTimer);
    burstTimer = null;
    if (doc.value) checkpoint = plainClone(doc.value);
  }

  // The first edit of a burst records the checkpoint; later edits only extend the burst.
  watch(
    form.revision,
    () => {
      if (suppressHistory || !doc.value || !checkpoint) return;
      if (!burstTimer) {
        pushHistory(undoStack.value, checkpoint);
        redoStack.value = [];
      } else clearTimeout(burstTimer);
      burstTimer = setTimeout(endBurst, HISTORY_BURST_MS);
    },
    { flush: 'sync' },
  );

  /** Replaces the document without recording history. */
  function replace(document: DraftDocument): void {
    suppressHistory = true;
    doc.value = document;
    checkpoint = plainClone(document);
    suppressHistory = false;
  }

  function open(document: DraftDocument): void {
    if (burstTimer) clearTimeout(burstTimer);
    burstTimer = null;
    suppressHistory = true;
    form.load(document);
    suppressHistory = false;
    checkpoint = plainClone(document);
    undoStack.value = [];
    redoStack.value = [];
    conflict.value = null;
    changedElsewhere.value = null;
  }

  function close(): void {
    if (burstTimer) clearTimeout(burstTimer);
    burstTimer = null;
    changedElsewhere.value = null;
    suppressHistory = true;
    doc.value = null;
    suppressHistory = false;
    checkpoint = null;
    undoStack.value = [];
    redoStack.value = [];
  }

  /** The document as it is now, including an unfinished burst. */
  function current(): DraftDocument {
    return burstTimer || !checkpoint ? plainClone(doc.value as DraftDocument) : checkpoint;
  }

  function undo(): void {
    if (!doc.value || undoStack.value.length === 0) return;
    const now = current();
    if (burstTimer) clearTimeout(burstTimer);
    burstTimer = null;
    const previous = undoStack.value.pop() as HistoryEntry;
    pushHistory(redoStack.value, now);
    replace(previous.doc);
  }

  function redo(): void {
    if (!doc.value || redoStack.value.length === 0) return;
    const now = current();
    if (burstTimer) clearTimeout(burstTimer);
    burstTimer = null;
    const next = redoStack.value.pop() as HistoryEntry;
    pushHistory(undoStack.value, now);
    replace(next.doc);
  }

  /** Every path holding an error, and every path above it, so containers can mark themselves. */
  const errorPrefixes = computed(() => {
    const paths = new Set<string>();
    for (const detail of form.errors.value) {
      const path = detail.path ?? [];
      for (let depth = 1; depth <= path.length; depth += 1) {
        paths.add(pathKey(path.slice(0, depth)));
      }
    }
    return paths;
  });

  /** Whether the error is at `path` or anywhere inside it; for blocks holding a bad field. */
  function errorUnder(path: (string | number)[]): boolean {
    return path.length > 0 && errorPrefixes.value.has(pathKey(path));
  }

  /** Resolves to the saved row, or null after a toasted failure. */
  async function save(): Promise<DraftDocument | null> {
    if (!doc.value) return null;
    conflict.value = null;
    const outcome: { saved?: DraftDocument } = {};

    await form.submit(async () => {
      const editing = doc.value as DraftDocument;
      const payload = {
        spaceId: editing.spaceId,
        typeId: editing.typeId,
        locale: editing.locale,
        parentId: editing.parentId,
        title: editing.title,
        slug: editing.slug || undefined,
        fields: editing.fields,
        position: editing.position,
        tags: editing.tags,
      };
      const saved = editing.id
        ? await content.update({
            ...payload,
            id: editing.id,
            // Optimistic lock: the server rejects a write built on a stale version.
            ...(editing.version ? { expectedVersion: editing.version } : {}),
          })
        : await content.create(payload);
      outcome.saved = { ...editing, ...(saved as object) } as DraftDocument;
    });

    const next = outcome.saved;
    if (!next) {
      const detail = form.errors.value.find((d) => d.key === 'content.version.conflict');
      if (detail?.params) {
        conflict.value = {
          expected: Number(detail.params.expected),
          actual: Number(detail.params.actual),
        };
      }
      return null;
    }
    open(next);
    return next;
  }

  /** Called by the live feed when another actor wrote the open document. */
  function markChangedElsewhere(contentId: string, by: string, action: string): void {
    if (doc.value?.id === contentId) changedElsewhere.value = { by, action };
  }
  onScopeDispose(onChangedElsewhere(markChangedElsewhere));

  /** Discards local edits and reloads the server's version. */
  async function reload(): Promise<void> {
    if (!doc.value?.id) return;
    const fresh = await content.get(doc.value.spaceId, doc.value.id);
    if (fresh) open({ ...doc.value, ...(fresh as object) } as DraftDocument);
  }

  return {
    doc,
    saving: form.saving,
    errors: form.errors,
    conflict,
    changedElsewhere,
    isDirty: form.isDirty,
    revision: form.revision,
    canUndo,
    canRedo,
    open,
    close,
    undo,
    redo,
    save,
    reload,
    markChangedElsewhere,
    errorFor: form.fieldError,
    errorUnder,
  };
});
