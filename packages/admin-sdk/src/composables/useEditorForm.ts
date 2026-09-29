import { type ComputedRef, computed, type MaybeRefOrGetter, toValue, watch } from 'vue';
import type { ApiErrorDetail } from '../lib/api-errors';
import { useBreadcrumb } from './useBreadcrumb';
import { type DraftFormOptions, useDraftForm } from './useDraftForm';
import { useEditorShortcuts } from './useEditorShortcuts';
import { useUnsavedGuard } from './useUnsavedGuard';

export interface EditorFormOptions<TSource, TDraft extends object>
  extends DraftFormOptions<TDraft> {
  /** The loaded record; each new value reloads the draft, unless it matches the saved copy. */
  source: MaybeRefOrGetter<TSource | null | undefined>;
  toDraft: (source: TSource) => TDraft;
  /** The leave prompt's subject: "This menu". */
  what: MaybeRefOrGetter<string>;
  /** The breadcrumb's last crumb. */
  crumb: (draft: TDraft) => string | null | undefined;
  /** Bound to Mod+S. */
  save: () => unknown;
  /** Error paths shown beside an input (first segments, or a test); the rest are `otherErrors`. */
  inline?: readonly string[] | ((path: (string | number)[]) => boolean);
  /** Words an `otherErrors` entry; the translated message by default. */
  describe?: (detail: ApiErrorDetail) => string;
}

export type EditorForm<TDraft extends object> = Omit<
  ReturnType<typeof useDraftForm<TDraft>>,
  'otherErrors'
> & {
  /** Messages for errors with no input to show them. */
  otherErrors: ComputedRef<string[]>;
};

/**
 * An editor page's form: `useDraftForm` loaded from `source` (keeping edits over identical
 * refetches), the unsaved-changes guard, the breadcrumb, Mod+S and the errors without an input.
 */
export function useEditorForm<TSource, TDraft extends object>(
  options: EditorFormOptions<TSource, TDraft>,
): EditorForm<TDraft> {
  const { source, toDraft, what, crumb, save, inline, describe, ...draftOptions } = options;
  const form = useDraftForm<TDraft>(draftOptions);

  watch(
    () => toValue(source),
    (loaded) => {
      if (loaded) form.load(toDraft(loaded), { keepEdits: true });
    },
    { immediate: true },
  );

  useUnsavedGuard(() => form.isDirty.value, what);
  useBreadcrumb(() => (form.draft.value ? crumb(form.draft.value) : null));
  useEditorShortcuts({ save: () => void save() });

  const shown =
    typeof inline === 'function'
      ? inline
      : (path: (string | number)[]) => (inline ?? []).includes(String(path[0]));
  const otherErrors = computed(() => form.otherErrors(shown, describe));

  return { ...form, otherErrors };
}
