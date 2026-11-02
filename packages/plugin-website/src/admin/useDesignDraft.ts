import {
  type ApiErrorDetail,
  errorDetails,
  errorKey,
  messageFor,
  messageForKey,
  plainClone,
  useSpaceStore,
} from '@manablox/admin-sdk';
import type { SiteDesignData, SiteDesignKind } from '@manablox/site';
import { useDebounceFn } from '@vueuse/core';
import {
  type ComputedRef,
  computed,
  type MaybeRefOrGetter,
  onScopeDispose,
  type Ref,
  ref,
  type ShallowRef,
  shallowRef,
  toValue,
  watch,
} from 'vue';
import type { SiteDesignKindName } from '../sdk';
import { jsonEqual } from './model/plain-data';
import { design, useSiteDesign } from './queries';

/** Autosave waits this long after the last edit. */
const AUTOSAVE_MS = 800;
/** Edits closer together than this share one undo step. */
const COALESCE_MS = 500;
const HISTORY_LIMIT = 100;
/** How long after the last edit the draft is compared to the saved copy, like `useDraftForm`. */
const SETTLE_MS = 400;

export interface DesignDraftOptions<K extends SiteDesignKind = SiteDesignKind> {
  /** Autosave after edits; off, `save()` stores the draft. */
  autosave?: boolean;
  /** A read-only viewer never saves. */
  readOnly?: MaybeRefOrGetter<boolean>;
  /** The data while the server stores none (block designs are generated in the client). */
  fallback?: () => SiteDesignData<K> | null;
}

/**
 * One design's draft: loads it, keeps an undo stack, autosaves with the optimistic version
 * and reports a conflict when someone else saved in between.
 *
 * Designs are replaced, never changed in place, so the undo stack keeps the replaced
 * designs themselves and nothing is serialised per edit. Each edit bumps a revision; the
 * draft is compared to the saved copy once edits settle (and before a save), so an edit
 * undone by hand reads clean again.
 */
export function useDesignDraft<K extends SiteDesignKind>(
  kind: MaybeRefOrGetter<K>,
  key: MaybeRefOrGetter<string>,
  options: DesignDraftOptions<K> = {},
): DesignDraft<K> {
  const spaces = useSpaceStore();
  const query = useSiteDesign(
    () => toValue(kind) as SiteDesignKindName,
    () => toValue(key),
  );

  const draft: ShallowRef<SiteDesignData<K> | null> = shallowRef(null);
  /** The stored version the draft builds on; `0` while generated. */
  const baseVersion = ref(0);
  /** What the server holds, to tell a dirty draft. */
  let saved: SiteDesignData<K> | null = null;
  /** Bumped by every edit, undo and redo; `savedRevision` is the one the saved copy matches. */
  const revision = ref(0);
  const savedRevision = ref(0);
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  const saving = ref(false);
  const saveError = ref<string | null>(null);
  const issues = ref<ApiErrorDetail[]>([]);
  const conflict = ref<{ expected: number; actual: number | null } | null>(null);
  /** Someone else saved while this draft has unsaved edits. */
  const changedElsewhere = ref(false);
  const lastSavedAt = ref<Date | null>(null);

  const undoStack: ShallowRef<SiteDesignData<K>[]> = shallowRef([]);
  const redoStack: ShallowRef<SiteDesignData<K>[]> = shallowRef([]);
  let lastEditAt = 0;
  let lastEditGroup: string | null = null;

  const isDirty = computed(() => draft.value !== null && revision.value !== savedRevision.value);
  const readOnly = () => toValue(options.readOnly) === true;

  function stopSettle(): void {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = null;
  }

  /** Compares a draft edited since the last save with the saved copy. */
  function settle(): void {
    stopSettle();
    if (revision.value !== savedRevision.value && jsonEqual(draft.value, saved)) {
      savedRevision.value = revision.value;
    }
  }

  /** Counts a change of the draft; back at the saved copy itself, it is clean at once. */
  function changed(): void {
    revision.value += 1;
    stopSettle();
    if (draft.value === saved) savedRevision.value = revision.value;
    else settleTimer = setTimeout(settle, SETTLE_MS);
  }

  function adopt(): void {
    const detail = query.data.value;
    if (!detail) return;
    // A generated design counts as saved until the first edit stores it.
    const data = detail.data ?? options.fallback?.() ?? null;
    draft.value = plainClone(data) as SiteDesignData<K>;
    baseVersion.value = detail.design?.version ?? 0;
    saved = draft.value;
    stopSettle();
    savedRevision.value = revision.value;
    saveError.value = null;
    changedElsewhere.value = false;
    conflict.value = null;
    issues.value = [];
  }

  // Follows the server while clean; flags a newer version when there are local edits.
  watch(
    () => query.data.value,
    (detail) => {
      // An own save updates the cache before `baseVersion` follows.
      if (!detail || saving.value) return;
      settle();
      const version = detail.design?.version ?? 0;
      if (draft.value === null || !isDirty.value) {
        if (version !== baseVersion.value || draft.value === null) adopt();
        return;
      }
      if (version > baseVersion.value) changedElsewhere.value = true;
    },
    { immediate: true },
  );

  /**
   * Replaces the draft with `next`, recording an undo step. Edits of the same `group` within
   * a moment share one step, so typing does not fill the stack.
   */
  function update(next: SiteDesignData<K>, group?: string): void {
    if (draft.value === null || readOnly()) return;
    const now = Date.now();
    const coalesce =
      group !== undefined && group === lastEditGroup && now - lastEditAt < COALESCE_MS;
    if (!coalesce) {
      undoStack.value = [...undoStack.value, draft.value].slice(-HISTORY_LIMIT);
    }
    redoStack.value = [];
    lastEditAt = now;
    lastEditGroup = group ?? null;
    draft.value = next;
    changed();
  }

  function undo(): void {
    const previous = undoStack.value.at(-1);
    if (previous === undefined || draft.value === null) return;
    undoStack.value = undoStack.value.slice(0, -1);
    redoStack.value = [...redoStack.value, draft.value];
    lastEditGroup = null;
    draft.value = previous;
    changed();
  }

  function redo(): void {
    const next = redoStack.value.at(-1);
    if (next === undefined || draft.value === null) return;
    redoStack.value = redoStack.value.slice(0, -1);
    undoStack.value = [...undoStack.value, draft.value];
    lastEditGroup = null;
    draft.value = next;
    changed();
  }

  async function save(): Promise<boolean> {
    const spaceId = spaces.currentId;
    if (!spaceId || draft.value === null || readOnly()) return false;
    settle();
    if (!isDirty.value) return true;
    if (saving.value || conflict.value) return false;
    saving.value = true;
    saveError.value = null;
    const sent = draft.value;
    const sentRevision = revision.value;
    try {
      const row = await design.saveDraft(spaceId, {
        kind: toValue(kind) as SiteDesignKindName,
        key: toValue(key),
        draft: plainClone(sent),
        expectedVersion: baseVersion.value,
      });
      baseVersion.value = row.version;
      saved = sent;
      savedRevision.value = sentRevision;
      // Edits made meanwhile may have come back to what was sent.
      if (revision.value !== sentRevision) settle();
      issues.value = [];
      lastSavedAt.value = new Date();
      return true;
    } catch (caught) {
      if (errorKey(caught) === 'plugins.website.design.versionConflict') {
        const params = errorDetails(caught)[0]?.params ?? {};
        conflict.value = {
          expected: baseVersion.value,
          actual: typeof params.actual === 'number' ? params.actual : null,
        };
      } else {
        issues.value = errorDetails(caught).filter(
          (detail) => detail.key === 'plugins.website.design.invalid',
        );
        // With issues, the list says what; the sentence names the refusal.
        saveError.value = issues.value.length
          ? messageForKey(errorKey(caught))
          : messageFor(caught);
      }
      return false;
    } finally {
      saving.value = false;
    }
  }

  const autosave = useDebounceFn(() => {
    settle();
    if (isDirty.value && !saveError.value) void save();
  }, AUTOSAVE_MS);
  if (options.autosave !== false) {
    watch(revision, () => {
      // A new edit may fix what the server refused.
      saveError.value = null;
      if (isDirty.value && !readOnly()) void autosave();
    });
  }

  /** Drops local edits and takes the stored draft. */
  async function reload(): Promise<void> {
    await query.refetch();
    adopt();
    undoStack.value = [];
    redoStack.value = [];
  }

  // Saves pending edits when the editor closes.
  onScopeDispose(() => {
    settle();
    if (isDirty.value && !conflict.value && !readOnly()) void save();
  });

  return {
    query,
    draft,
    baseVersion,
    isDirty,
    saving,
    saveError,
    issues,
    conflict,
    changedElsewhere,
    lastSavedAt,
    canUndo: computed(() => undoStack.value.length > 0),
    canRedo: computed(() => redoStack.value.length > 0),
    update,
    undo,
    redo,
    save,
    reload,
  };
}

/** The save state of any design's draft, for notices. */
export interface DesignDraftState {
  saveError: Ref<string | null>;
  issues: Ref<ApiErrorDetail[]>;
  conflict: Ref<{ expected: number; actual: number | null } | null>;
  changedElsewhere: Ref<boolean>;
  reload: () => Promise<void>;
}

export interface DesignDraft<K extends SiteDesignKind> extends DesignDraftState {
  query: ReturnType<typeof useSiteDesign>;
  draft: ShallowRef<SiteDesignData<K> | null>;
  baseVersion: Ref<number>;
  isDirty: ComputedRef<boolean>;
  saving: Ref<boolean>;
  lastSavedAt: Ref<Date | null>;
  canUndo: ComputedRef<boolean>;
  canRedo: ComputedRef<boolean>;
  update: (next: SiteDesignData<K>, group?: string) => void;
  undo: () => void;
  redo: () => void;
  save: () => Promise<boolean>;
}
