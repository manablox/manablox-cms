import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';

const content = vi.hoisted(() => ({
  publish: vi.fn(),
  unpublish: vi.fn(),
  schedule: vi.fn(),
  duplicate: vi.fn(),
  childCount: vi.fn(),
  remove: vi.fn(),
  invalidate: vi.fn(),
}));
const confirm = vi.hoisted(() => vi.fn());
const confirmChoice = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const routeLeave = vi.hoisted(() => ({ guard: null as null | (() => Promise<boolean> | boolean) }));

vi.mock('@manablox/admin-sdk/features/content/queries', () => ({ content }));
vi.mock('@manablox/admin-sdk/lib/confirm', () => ({ confirm, confirmChoice }));
vi.mock('@manablox/admin-sdk/lib/toast', () => ({ toast }));
vi.mock('vue-router', () => ({
  onBeforeRouteLeave: (guard: () => Promise<boolean> | boolean) => {
    routeLeave.guard = guard;
  },
}));

import { resetShortcuts, shortcutGroups } from '@manablox/admin-sdk/lib/shortcuts';
import { type ContentSaveDraft, useContentSave } from '~/features/content/useContentSave';
import type { DraftDocument } from '~/features/content/useDraftStore';

const makeDocument = (): DraftDocument => ({
  id: 'doc-1',
  spaceId: 'space-1',
  typeId: 'type-1',
  locale: 'en',
  parentId: null,
  title: 'Hello',
  slug: 'hello',
  fields: {},
  position: 0,
  version: 2,
  tags: [],
});

function fakeDraft(doc: DraftDocument | null = makeDocument()): ContentSaveDraft {
  return {
    doc,
    isDirty: false,
    errors: [],
    canUndo: false,
    canRedo: false,
    save: vi.fn(async () => doc),
    undo: vi.fn(),
    redo: vi.fn(),
    close: vi.fn(),
  };
}

const scopes: (() => void)[] = [];

function setup(draft = fakeDraft(), overrides: { isNew?: boolean; canPublish?: boolean } = {}) {
  const router = { push: vi.fn(async () => undefined), replace: vi.fn(async () => undefined) };
  const editor = ref<HTMLElement | null>(null);
  const scope = effectScope();
  const save = scope.run(() =>
    useContentSave({
      draft,
      editor,
      router,
      section: () => '/content',
      isNew: () => overrides.isNew ?? false,
      canPublish: () => overrides.canPublish ?? true,
      isPublishable: () => true,
    }),
  )!;
  scopes.push(() => scope.stop());
  return { save, router, editor, draft };
}

function press(keys: { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) {
  window.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, ...keys }),
  );
}

describe('useContentSave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirm.mockResolvedValue(true);
    content.childCount.mockResolvedValue(0);
  });
  afterEach(() => {
    for (const stop of scopes.splice(0)) stop();
    resetShortcuts();
    window.document.body.innerHTML = '';
  });

  it('marks a successful save and moves a new document to its own route', async () => {
    const draft = fakeDraft();
    const { save, router } = setup(draft, { isNew: true });
    expect(save.status.value).toBeNull();
    await expect(save.save()).resolves.toBe(true);
    expect(save.status.value).toBe('Saved');
    expect(toast.success).toHaveBeenCalledWith('Saved');
    expect(router.replace).toHaveBeenCalledWith('/content/doc-1');

    const existing = setup(fakeDraft());
    await existing.save.save();
    expect(existing.router.replace).not.toHaveBeenCalled();
  });

  it('reveals the first invalid field after a refused save', async () => {
    const draft = fakeDraft();
    draft.save = vi.fn(async () => null);
    draft.errors = [{ key: 'validation.failed' }];
    const { save, editor } = setup(draft);
    const root = window.document.createElement('div');
    root.innerHTML = '<div data-invalid><input id="bad" /></div>';
    window.document.body.append(root);
    editor.value = root;
    const scrolled = vi.fn();
    root.querySelector<HTMLElement>('[data-invalid]')!.scrollIntoView = scrolled;

    await expect(save.save()).resolves.toBe(false);
    await nextTick();
    expect(scrolled).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    expect(window.document.activeElement?.id).toBe('bad');
    expect(save.status.value).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('keeps a version conflict quiet: no reveal without field errors', async () => {
    const draft = fakeDraft();
    draft.save = vi.fn(async () => null);
    const { save, editor } = setup(draft);
    const root = window.document.createElement('div');
    root.innerHTML = '<div data-invalid><input id="bad" /></div>';
    window.document.body.append(root);
    editor.value = root;
    await save.save();
    await nextTick();
    expect(window.document.activeElement?.id).not.toBe('bad');
  });

  it('saves before publishing when dirty and stops when that fails', async () => {
    const draft = fakeDraft();
    draft.isDirty = true;
    draft.save = vi.fn(async () => null);
    const { save } = setup(draft);
    await save.publish();
    expect(content.publish).not.toHaveBeenCalled();

    draft.save = vi.fn(async () => makeDocument());
    await save.publish();
    expect(content.publish).toHaveBeenCalledWith('space-1', 'doc-1');
    expect(save.isPublished.value).toBe(true);
    expect(save.status.value).toBe('Published');
  });

  it('flags a published document as changed after a save', async () => {
    const { save } = setup();
    save.adopt({ status: 'published', publishAt: null, unpublishAt: null });
    expect(save.canPublishNow.value).toBe(false);
    await save.save();
    expect(save.savedSincePublish.value).toBe(true);
    expect(save.canPublishNow.value).toBe(true);
    save.onApproved();
    expect(save.savedSincePublish.value).toBe(false);
    expect(save.status.value).toBe('Published');
  });

  it('registers save, undo, redo and publish shortcuts', async () => {
    const draft = fakeDraft();
    draft.canUndo = true;
    const { save } = setup(draft);
    const labels = shortcutGroups.value
      .flatMap((group) => group.shortcuts)
      .map((shortcut) => shortcut.label);
    expect(labels).toEqual(expect.arrayContaining(['Save', 'Undo', 'Redo', 'Publish']));

    press({ key: 's' });
    await nextTick();
    expect(draft.save).toHaveBeenCalledTimes(1);
    press({ key: 'z' });
    expect(draft.undo).toHaveBeenCalledTimes(1);
    press({ key: 'Enter' });
    await vi.waitFor(() => expect(content.publish).toHaveBeenCalledWith('space-1', 'doc-1'));
    expect(save.isPublished.value).toBe(true);
  });

  it('does not publish from the keyboard without permission', () => {
    setup(fakeDraft(), { canPublish: false });
    press({ key: 'Enter' });
    expect(content.publish).not.toHaveBeenCalled();
  });

  it('guards route leave while the draft is dirty', async () => {
    const draft = fakeDraft();
    setup(draft);
    await expect(routeLeave.guard!()).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    draft.isDirty = true;
    confirm.mockResolvedValueOnce(false);
    await expect(routeLeave.guard!()).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Leave without saving?' }),
    );
  });

  it('duplicates after confirming unsaved edits, then opens the copy', async () => {
    const draft = fakeDraft();
    draft.isDirty = true;
    content.duplicate.mockResolvedValue({ id: 'doc-2', title: 'Hello (copy)' });
    const { save, router } = setup(draft);
    confirm.mockResolvedValueOnce(false);
    await save.duplicate();
    expect(content.duplicate).not.toHaveBeenCalled();

    await save.duplicate();
    expect(content.duplicate).toHaveBeenCalledWith('space-1', 'doc-1', false);
    expect(confirmChoice).not.toHaveBeenCalled();
    expect(draft.close).toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith('/content/doc-2');
    expect(toast.success).toHaveBeenCalledWith('Copied to "Hello (copy)"');
  });

  it('asks what to do with the children before duplicating a document that has them', async () => {
    content.duplicate.mockResolvedValue({ id: 'doc-2', title: 'Hello (copy)' });
    content.childCount.mockResolvedValue(3);
    const { save } = setup(fakeDraft());

    confirmChoice.mockResolvedValueOnce(null);
    await save.duplicate();
    expect(content.duplicate).not.toHaveBeenCalled();

    confirmChoice.mockResolvedValueOnce('single');
    await save.duplicate();
    expect(content.duplicate).toHaveBeenLastCalledWith('space-1', 'doc-1', false);

    confirmChoice.mockResolvedValueOnce('subtree');
    await save.duplicate();
    expect(content.duplicate).toHaveBeenLastCalledWith('space-1', 'doc-1', true);
  });

  it('deletes after confirming, leaves, then invalidates', async () => {
    const draft = fakeDraft();
    const { save, router } = setup(draft);
    confirm.mockResolvedValueOnce(false);
    await save.remove();
    expect(content.remove).not.toHaveBeenCalled();

    await save.remove();
    expect(content.remove).toHaveBeenCalledWith('space-1', 'doc-1');
    expect(draft.close).toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/content');
    expect(content.invalidate).toHaveBeenCalledWith('space-1');
    expect(toast.success).toHaveBeenCalledWith('Deleted "Hello"');

    content.remove.mockRejectedValueOnce(new Error('nope'));
    await save.remove();
    expect(toast.error).toHaveBeenCalled();
  });
});
