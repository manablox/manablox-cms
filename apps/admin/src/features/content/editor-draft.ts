import type { ContentEditorDraft } from '@manablox/admin-plugin';
import type { useDraftStore } from './useDraftStore';

/** The document draft as plugin views see it: live reads, undo and redo, errors and save. */
export function editorDraftOf(
  draft: ReturnType<typeof useDraftStore>,
  options: { readOnly: () => boolean; save: () => Promise<unknown> },
): ContentEditorDraft {
  return {
    get isDirty() {
      return draft.isDirty;
    },
    get readOnly() {
      return options.readOnly();
    },
    get saving() {
      return draft.saving;
    },
    get revision() {
      return draft.revision;
    },
    get canUndo() {
      return draft.canUndo;
    },
    get canRedo() {
      return draft.canRedo;
    },
    undo: () => draft.undo(),
    redo: () => draft.redo(),
    errorFor: (path) => draft.errorFor([...path]),
    errorUnder: (path) => draft.errorUnder([...path]),
    save: () => options.save(),
  };
}
