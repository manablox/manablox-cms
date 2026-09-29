import { computed, type Ref, ref, watch } from 'vue';
import { type ApiErrorDetail, errorDetails, errorKey } from '../lib/api-errors';
import { messageFor, messageForKey, NOT_SAVED } from '../lib/messages';
import { runWrite } from '../lib/write';

export interface DraftFormOptions<T> {
  /** Compares the draft to the saved copy. Defaults to `JSON.stringify`. */
  serialise?: (value: T) => string;
  /** Watches only top-level keys, or this many levels; for drafts whose edits replace values there. */
  shallow?: boolean | number;
}

/** How long after the last edit the draft is compared to the saved copy. */
export const SETTLE_MS = 400;

/** A map key for an error path; NUL never occurs in field names. */
export function pathKey(path: readonly (string | number)[]): string {
  return path.join('\0');
}

/** An error lookup by field path, like `useDraftForm().fieldError`. */
export type ErrorFor = (path: readonly (string | number)[]) => string | null;

/** `errorFor` for paths under `prefix`. */
export function scoped(errorFor: ErrorFor, prefix: readonly (string | number)[]): ErrorFor {
  return (path) => errorFor([...prefix, ...path]);
}

/**
 * Shared form state: draft, dirty flag, field errors, and `submit`. After a successful
 * `submit`, call `markSaved()` or `load()`.
 */
export function useDraftForm<T extends object>(options: DraftFormOptions<T> = {}) {
  const serialise = options.serialise ?? ((value: T) => JSON.stringify(value));

  const draft = ref<T | null>(null) as Ref<T | null>;
  const pristine = ref<string | null>(null);
  const saving = ref(false);
  const errors = ref<ApiErrorDetail[]>([]);

  /** Bumped synchronously on every edit; `savedRevision` is where the saved copy sits. */
  const revision = ref(0);
  const savedRevision = ref(0);
  let settleTimer: ReturnType<typeof setTimeout> | null = null;

  /** Serialises once per edit burst, so a draft edited back to the saved copy reads clean. */
  function settle(): void {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = null;
    if (draft.value !== null && serialise(draft.value) === pristine.value) {
      savedRevision.value = revision.value;
    }
  }

  watch(
    draft,
    () => {
      revision.value += 1;
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(settle, SETTLE_MS);
    },
    { deep: options.shallow === true ? 1 : options.shallow || true, flush: 'sync' },
  );

  const isDirty = computed(() => draft.value !== null && revision.value !== savedRevision.value);

  /** Errors indexed by path. */
  const errorIndex = computed(() => {
    const index = new Map<string, ApiErrorDetail>();
    for (const detail of errors.value) {
      const key = pathKey(detail.path ?? []);
      if (!index.has(key)) index.set(key, detail);
    }
    return index;
  });

  /** Sets draft and saved copy; with `keepEdits`, skips when unchanged from the saved copy. */
  function load(value: T, { keepEdits = false }: { keepEdits?: boolean } = {}): void {
    const serialised = serialise(value);
    if (keepEdits && serialised === pristine.value) return;
    draft.value = value;
    pristine.value = serialised;
    errors.value = [];
    markSaved();
  }

  function markSaved(): void {
    if (draft.value === null) return;
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = null;
    pristine.value = serialise(draft.value);
    savedRevision.value = revision.value;
  }

  /** The error message at a field path. */
  function fieldError(path: readonly (string | number)[]): string | null {
    const match = errorIndex.value.get(pathKey(path));
    return match ? messageForKey(match.key, match.params) : null;
  }

  /** Errors not shown inline; `inline` lists the paths that have an input, or tests them. */
  function otherErrors(
    inline: readonly (readonly (string | number)[])[] | ((path: (string | number)[]) => boolean),
    describe: (detail: ApiErrorDetail) => string = (detail) =>
      messageForKey(detail.key, detail.params),
  ): string[] {
    const shown =
      typeof inline === 'function'
        ? inline
        : (path: (string | number)[]) => {
            const key = pathKey(path);
            return inline.some((candidate) => pathKey(candidate) === key);
          };
    return errors.value.filter((detail) => !shown(detail.path ?? [])).map(describe);
  }

  /** Runs a write; resolves to success. Failures are toasted, never thrown. */
  async function submit(fn: () => Promise<void>): Promise<boolean> {
    if (saving.value) return false;
    errors.value = [];
    return runWrite(fn, {
      busy: saving,
      describe: (error) => {
        errors.value = errorDetails(error);
        // A control refusal names no field.
        const marked = errors.value.length > 0 && !errorKey(error).startsWith('control.');
        return marked ? NOT_SAVED : messageFor(error);
      },
    });
  }

  return {
    draft,
    pristine,
    revision,
    isDirty,
    saving,
    errors,
    load,
    markSaved,
    settle,
    fieldError,
    otherErrors,
    submit,
  };
}
