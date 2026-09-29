import { useEditorShortcuts } from '@manablox/admin-sdk/composables/useEditorShortcuts';
import { useShortcuts } from '@manablox/admin-sdk/composables/useShortcuts';
import { useUnsavedGuard } from '@manablox/admin-sdk/composables/useUnsavedGuard';
import { content } from '@manablox/admin-sdk/features/content/queries';
import { confirm } from '@manablox/admin-sdk/lib/confirm';
import { focusFirstField } from '@manablox/admin-sdk/lib/focus';
import { toast } from '@manablox/admin-sdk/lib/toast';
import { confirmAndRun, runWrite } from '@manablox/admin-sdk/lib/write';
import { nextTick, type Ref, ref } from 'vue';
import type { Router } from 'vue-router';
import { duplicateChoice } from '~/features/content/model/duplicate-prompt';
import type { DraftDocument } from '~/features/content/useDraftStore';
import { usePublishing } from '~/features/content/usePublishing';

/** The slice of the draft store the orchestration reads. */
export interface ContentSaveDraft {
  doc: DraftDocument | null;
  isDirty: boolean;
  errors: unknown[];
  canUndo: boolean;
  canRedo: boolean;
  save: () => Promise<DraftDocument | null>;
  undo: () => void;
  redo: () => void;
  close: () => void;
}

export interface ContentSaveOptions {
  draft: ContentSaveDraft;
  /** The editor's root; a refused save reveals its first invalid field. */
  editor: Readonly<Ref<HTMLElement | null | undefined>>;
  router: Pick<Router, 'push' | 'replace'>;
  /** `/content`, `/templates` or `/databags/<type id>`; new documents move under it once saved. */
  section: () => string;
  isNew: () => boolean;
  canPublish: () => boolean;
  isPublishable: () => boolean;
}

/** Save, publish, schedule, duplicate and delete for the content editor, with their shortcuts. */
export function useContentSave(options: ContentSaveOptions) {
  const { draft, router } = options;
  const status = ref<string | null>(null);
  const duplicating = ref(false);

  const publishing = usePublishing({
    target: () =>
      draft.doc?.id
        ? { spaceId: draft.doc.spaceId, id: draft.doc.id, title: draft.doc.title }
        : null,
    isDirty: () => draft.isDirty,
    save: () => save(),
    setStatus: (value) => {
      status.value = value;
    },
  });

  /** After a refused save, brings the first field the server complained about into view. */
  function revealFirstError(): void {
    void nextTick(() => {
      const target = options.editor.value?.querySelector<HTMLElement>('[data-invalid]');
      if (!target) return;
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      focusFirstField(target);
    });
  }

  /** Resolves to whether the save worked; failures are toasted by the store. */
  async function save(): Promise<boolean> {
    status.value = null;
    const saved = await draft.save();
    if (!saved) {
      if (draft.errors.length) revealFirstError();
      return false;
    }
    status.value = 'Saved';
    toast.success('Saved');
    publishing.saved();
    if (saved.id && options.isNew()) {
      await router.replace(`${options.section()}/${saved.id}`);
    }
    return true;
  }

  /** An approval published the document. */
  function onApproved(): void {
    publishing.publishedElsewhere();
    status.value = 'Published';
  }

  /** Duplicates the document and opens the copy. */
  async function duplicate(): Promise<void> {
    if (!draft.doc?.id || duplicating.value) return;
    if (draft.isDirty) {
      const confirmed = await confirm({
        title: 'Duplicate this document?',
        message: 'The copy is made from the last saved version; unsaved changes are not in it.',
        confirmLabel: 'Duplicate anyway',
      });
      if (!confirmed) return;
    }
    const { spaceId, id, locale, title } = draft.doc;

    // A document with children asks whether the copy takes them along.
    let children = false;
    if (await content.childCount(spaceId, locale, id).catch(() => 0)) {
      const choice = await duplicateChoice(title || 'Untitled');
      if (!choice) return;
      children = choice === 'subtree';
    }

    await runWrite(
      async () => {
        const copy = await content.duplicate(spaceId, id, children);
        draft.close();
        await router.push(`${options.section()}/${copy.id}`);
        return copy;
      },
      { busy: duplicating, success: (copy) => `Copied to "${copy.title}"` },
    );
  }

  async function remove(): Promise<void> {
    if (!draft.doc?.id) return;
    const { spaceId, id, title } = draft.doc;
    await confirmAndRun(
      {
        title: 'Delete this document?',
        message: 'Every document beneath it in the tree is deleted along with it.',
        confirmLabel: 'Delete document',
        danger: true,
      },
      async () => {
        await content.remove(spaceId, id);
        draft.close();
        // Navigate first, or the translation switcher refetches the deleted document and 404s.
        await router.replace(options.section());
        content.invalidate(spaceId);
      },
      { success: `Deleted "${title || 'Untitled'}"` },
    );
  }

  useUnsavedGuard(() => draft.isDirty);
  useEditorShortcuts({
    save: () => void save(),
    undo: () => draft.undo(),
    redo: () => draft.redo(),
    canUndo: () => draft.canUndo,
    canRedo: () => draft.canRedo,
  });
  /* Publish is `mod+Enter`: bare letters are typing, and Shift+letter hits browser shortcuts. */
  useShortcuts(() => [
    {
      keys: 'mod+enter',
      label: 'Publish',
      whileTyping: true,
      enabled: () =>
        options.canPublish() && options.isPublishable() && publishing.canPublishNow.value,
      run: () => void publishing.publish(),
    },
  ]);

  return {
    ...publishing,
    status,
    duplicating,
    save,
    revealFirstError,
    onApproved,
    duplicate,
    remove,
  };
}
