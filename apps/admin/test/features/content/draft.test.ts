import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  content: {
    create: vi.fn(),
    update: vi.fn(),
    get: vi.fn(),
  },
}));

vi.mock('@manablox/admin-sdk/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@manablox/admin-sdk/lib/api')>(
    '@manablox/admin-sdk/lib/api',
  );
  return { ...actual, api };
});
vi.mock('@manablox/admin-sdk/features/content/queries', () => ({
  content: {
    create: api.content.create,
    update: api.content.update,
    get: (spaceId: string, id: string) => api.content.get({ spaceId, id }),
  },
}));
vi.mock('@manablox/admin-sdk/lib/toast', () => ({ toast: { error: vi.fn() } }));

import { NOT_SAVED } from '@manablox/admin-sdk/lib/messages';
import { toast } from '@manablox/admin-sdk/lib/toast';
import {
  type DraftDocument,
  HISTORY_BURST_MS,
  useDraftStore,
} from '~/features/content/useDraftStore';

const document = (): DraftDocument => ({
  id: 'doc-1',
  spaceId: 'space-1',
  typeId: 'type-1',
  locale: 'en',
  parentId: null,
  title: 'Hello',
  slug: 'hello',
  fields: { body: 'text', blocks: [{ headline: 'One' }] },
  position: 0,
  version: 3,
  tags: [],
});

/** Lets the edit burst and the pristine check run. */
const settle = () => vi.advanceTimersByTime(HISTORY_BURST_MS + 1);

describe('draft store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is pristine after open and dirty after an edit', () => {
    const draft = useDraftStore();
    draft.open(document());
    expect(draft.isDirty).toBe(false);

    draft.doc!.title = 'Changed';
    expect(draft.isDirty).toBe(true);
    settle();
    expect(draft.isDirty).toBe(true);
  });

  it('is clean again once edited back to the saved copy', () => {
    const draft = useDraftStore();
    draft.open(document());
    draft.doc!.fields.body = 'other';
    draft.doc!.fields.body = 'text';
    expect(draft.isDirty).toBe(true);
    settle();
    expect(draft.isDirty).toBe(false);
  });

  it('coalesces rapid edits into one undo entry', () => {
    const draft = useDraftStore();
    draft.open(document());
    for (const title of ['H', 'He', 'Hel', 'Help']) {
      draft.doc!.title = title;
      vi.advanceTimersByTime(50);
    }
    settle();
    draft.doc!.title = 'Help!';
    settle();

    draft.undo();
    expect(draft.doc?.title).toBe('Help');
    draft.undo();
    expect(draft.doc?.title).toBe('Hello');
    expect(draft.canUndo).toBe(false);
  });

  it('undoes an unfinished burst and redoes it', () => {
    const draft = useDraftStore();
    draft.open(document());
    draft.doc!.title = 'One';
    settle();
    draft.doc!.title = 'Two';
    expect(draft.canUndo).toBe(true);

    draft.undo();
    expect(draft.doc?.title).toBe('One');
    draft.undo();
    expect(draft.doc?.title).toBe('Hello');
    expect(draft.canUndo).toBe(false);

    draft.redo();
    expect(draft.doc?.title).toBe('One');
    draft.redo();
    expect(draft.doc?.title).toBe('Two');
    expect(draft.canRedo).toBe(false);
  });

  it('keeps nested edits apart from their snapshots', () => {
    const draft = useDraftStore();
    draft.open(document());
    const blocks = draft.doc!.fields.blocks as { headline: string }[];
    // Field values are replaced, never mutated in place; the draft watches two levels deep.
    draft.doc!.fields.blocks = [{ ...blocks[0], headline: 'Two' }];
    settle();
    draft.undo();
    expect((draft.doc!.fields.blocks as { headline: string }[])[0]!.headline).toBe('One');
    draft.redo();
    expect((draft.doc!.fields.blocks as { headline: string }[])[0]!.headline).toBe('Two');
  });

  it('a fresh edit after undo clears the redo stack', () => {
    const draft = useDraftStore();
    draft.open(document());
    draft.doc!.title = 'One';
    settle();
    draft.undo();
    expect(draft.canRedo).toBe(true);
    draft.doc!.title = 'Other';
    expect(draft.canRedo).toBe(false);
  });

  it('caps the history at fifty entries', () => {
    const draft = useDraftStore();
    draft.open(document());
    for (let step = 1; step <= 60; step += 1) {
      draft.doc!.title = `Step ${step}`;
      settle();
    }
    let undone = 0;
    while (draft.canUndo) {
      draft.undo();
      undone += 1;
    }
    expect(undone).toBe(50);
    expect(draft.doc?.title).toBe('Step 10');
  });

  it('drops the oldest entries once the snapshots outgrow the size cap', () => {
    const draft = useDraftStore();
    draft.open(document());
    // Each snapshot is about 3 MB, so only two fit under the cap.
    for (let step = 1; step <= 4; step += 1) {
      draft.doc!.fields.body = 'x'.repeat(3 * 1024 * 1024) + step;
      settle();
    }
    let undone = 0;
    while (draft.canUndo) {
      draft.undo();
      undone += 1;
    }
    expect(undone).toBe(2);
  });

  it('open clears the history and pending bursts', () => {
    const draft = useDraftStore();
    draft.open(document());
    draft.doc!.title = 'One';
    draft.open({ ...document(), title: 'Fresh' });
    settle();
    expect(draft.canUndo).toBe(false);
    expect(draft.isDirty).toBe(false);
    expect(draft.doc?.title).toBe('Fresh');
  });

  it('sends the version as an optimistic lock and reopens on the saved row', async () => {
    api.content.update.mockResolvedValue({ id: 'doc-1', version: 4, title: 'Hello' });
    const draft = useDraftStore();
    draft.open(document());
    draft.doc!.title = 'Hello';

    await draft.save();
    expect(api.content.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'doc-1', expectedVersion: 3 }),
    );
    expect(draft.doc?.version).toBe(4);
    expect(draft.isDirty).toBe(false);
    expect(draft.canUndo).toBe(false);
  });

  it('creates when there is no id', async () => {
    api.content.create.mockResolvedValue({ id: 'new', version: 1 });
    const draft = useDraftStore();
    const { id: _id, version: _version, ...fresh } = document();
    draft.open(fresh);

    await draft.save();
    expect(api.content.create).toHaveBeenCalledOnce();
    expect(draft.doc?.id).toBe('new');
  });

  it('records a version conflict from the error details', async () => {
    api.content.update.mockRejectedValue({
      message: 'content.validation.failed',
      data: {
        details: [{ key: 'content.version.conflict', params: { expected: 3, actual: 5 } }],
      },
    });
    const draft = useDraftStore();
    draft.open(document());

    expect(await draft.save()).toBeNull();
    expect(draft.conflict).toEqual({ expected: 3, actual: 5 });
    expect(draft.saving).toBe(false);
  });

  it('fills the errors and toasts when a save fails', async () => {
    api.content.update.mockRejectedValue({
      data: { details: [{ key: 'content.slug.duplicate', path: ['slug'], params: {} }] },
    });
    const draft = useDraftStore();
    draft.open(document());
    expect(await draft.save()).toBeNull();

    expect(draft.errors).toHaveLength(1);
    expect(toast.error).toHaveBeenCalledWith(NOT_SAVED);
    // Known keys become sentences; unknown ones fall back to the key.
    expect(draft.errorFor(['slug'])).toBe('Another document at this level already uses that slug.');
    expect(draft.errorFor(['title'])).toBeNull();
    expect(draft.isDirty).toBe(false);
  });

  it('reports the containers a nested error sits under', async () => {
    api.content.update.mockRejectedValue({
      data: { details: [{ key: 'field.required', path: ['body', 1, 'headline'], params: {} }] },
    });
    const draft = useDraftStore();
    draft.open(document());
    await draft.save();

    expect(draft.errorFor(['body', 1, 'headline'])).toBe('This is required.');
    expect(draft.errorUnder(['body', 1, 'headline'])).toBe(true);
    expect(draft.errorUnder(['body', 1])).toBe(true);
    expect(draft.errorUnder(['body'])).toBe(true);
    expect(draft.errorUnder(['body', 0])).toBe(false);
    expect(draft.errorUnder([])).toBe(false);
    // Only the leaf carries the message.
    expect(draft.errorFor(['body', 1])).toBeNull();
  });
});
