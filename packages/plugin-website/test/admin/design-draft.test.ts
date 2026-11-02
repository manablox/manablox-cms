import { setupAdminTest, useTestSpace } from '@manablox/admin-sdk/testing';
import { defaultTheme, type ThemeDesign } from '@manablox/site';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';

const detail = ref<{ data: unknown; status: string; design: { version: number } | null } | null>(
  null,
);
const saveDraft = vi.hoisted(() => vi.fn());

vi.mock('../../src/admin/queries', () => ({
  useSiteDesign: () => ({ data: detail, refetch: vi.fn(async () => undefined) }),
  design: { saveDraft },
}));

import { useDesignDraft } from '../../src/admin/useDesignDraft';

const conflict = () =>
  Object.assign(new Error('conflict'), {
    data: {
      key: 'plugins.website.design.versionConflict',
      kind: 'conflict',
      status: 409,
      message: 'plugins.website.design.versionConflict',
      details: [
        { key: 'plugins.website.design.versionConflict', params: { expected: 0, actual: 2 } },
      ],
    },
  });

function setup() {
  const scope = effectScope();
  const draft = scope.run(() => useDesignDraft('theme', 'default'))!;
  return { scope, draft };
}

const recolor = (theme: ThemeDesign, text: string): ThemeDesign => ({
  ...theme,
  colors: { ...theme.colors, roles: { ...theme.colors.roles, text } },
});

describe('useDesignDraft', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupAdminTest({ api: {} });
    useTestSpace();
    detail.value = { data: defaultTheme(), status: 'generated', design: null };
    saveDraft.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('autosaves an edit with the version it was made from', async () => {
    const { scope, draft } = setup();
    saveDraft.mockResolvedValue({ version: 1 });
    draft.update(recolor(draft.draft.value as ThemeDesign, '#111111'));
    await nextTick();
    expect(draft.isDirty.value).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(saveDraft).toHaveBeenCalledWith(
      'space-1',
      expect.objectContaining({ kind: 'theme', key: 'default', expectedVersion: 0 }),
    );
    expect(draft.isDirty.value).toBe(false);
    expect(draft.baseVersion.value).toBe(1);
    scope.stop();
  });

  it('undoes and redoes, sharing one step for edits of the same group', async () => {
    const { scope, draft } = setup();
    saveDraft.mockResolvedValue({ version: 1 });
    const start = draft.draft.value as ThemeDesign;
    draft.update(recolor(start, '#111111'), 'role:text');
    draft.update(recolor(start, '#222222'), 'role:text');
    expect(draft.canUndo.value).toBe(true);
    draft.undo();
    expect((draft.draft.value as ThemeDesign).colors.roles.text).toBe(start.colors.roles.text);
    expect(draft.canUndo.value).toBe(false);
    draft.redo();
    expect((draft.draft.value as ThemeDesign).colors.roles.text).toBe('#222222');
    scope.stop();
  });

  it('reads clean when undone back to the saved copy', async () => {
    const { scope, draft } = setup();
    saveDraft.mockResolvedValue({ version: 1 });
    const start = draft.draft.value as ThemeDesign;
    draft.update(recolor(start, '#111111'));
    expect(draft.isDirty.value).toBe(true);
    draft.undo();
    expect(draft.draft.value).toEqual(start);
    expect(draft.isDirty.value).toBe(false);
    draft.redo();
    expect(draft.isDirty.value).toBe(true);
    scope.stop();
  });

  it('reads clean once an edit changed back by hand settles, and does not save it', async () => {
    const { scope, draft } = setup();
    saveDraft.mockResolvedValue({ version: 1 });
    const start = draft.draft.value as ThemeDesign;
    draft.update(recolor(start, '#111111'), 'role:text');
    draft.update(recolor(start, start.colors.roles.text), 'role:text');
    expect(draft.isDirty.value).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(draft.isDirty.value).toBe(false);
    expect(saveDraft).not.toHaveBeenCalled();
    expect(draft.canUndo.value).toBe(true);
    scope.stop();
  });

  it('keeps edits made while a save runs dirty', async () => {
    const { scope, draft } = setup();
    let finish: (row: { version: number }) => void = () => {};
    saveDraft.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const start = draft.draft.value as ThemeDesign;
    draft.update(recolor(start, '#111111'));
    const saving = draft.save();
    draft.update(recolor(start, '#222222'));
    finish({ version: 1 });
    expect(await saving).toBe(true);
    expect(draft.isDirty.value).toBe(true);
    draft.undo();
    expect(draft.isDirty.value).toBe(false);
    scope.stop();
  });

  it('keeps the last hundred steps and drops redo on a new edit', async () => {
    const { scope, draft } = setup();
    saveDraft.mockResolvedValue({ version: 1 });
    const start = draft.draft.value as ThemeDesign;
    for (let step = 0; step < 105; step += 1)
      draft.update(recolor(start, `#${String(step).padStart(6, '0')}`));
    let steps = 0;
    while (draft.canUndo.value) {
      draft.undo();
      steps += 1;
    }
    expect(steps).toBe(100);
    expect((draft.draft.value as ThemeDesign).colors.roles.text).toBe('#000004');
    expect(draft.canRedo.value).toBe(true);
    draft.update(recolor(start, '#abcdef'));
    expect(draft.canRedo.value).toBe(false);
    scope.stop();
  });

  it('stops autosaving after a version conflict until reloaded', async () => {
    const { scope, draft } = setup();
    saveDraft.mockRejectedValue(conflict());
    draft.update(recolor(draft.draft.value as ThemeDesign, '#111111'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(draft.conflict.value).toEqual({ expected: 0, actual: 2 });
    draft.update(recolor(draft.draft.value as ThemeDesign, '#333333'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(saveDraft).toHaveBeenCalledTimes(1);

    detail.value = {
      data: recolor(defaultTheme(), '#444444'),
      status: 'unpublished',
      design: { version: 2 },
    };
    await draft.reload();
    expect(draft.conflict.value).toBeNull();
    expect((draft.draft.value as ThemeDesign).colors.roles.text).toBe('#444444');
    expect(draft.baseVersion.value).toBe(2);
    scope.stop();
  });

  it('does not mistake its own save for one made elsewhere', async () => {
    const { scope, draft } = setup();
    let finish: (row: { version: number }) => void = () => {};
    saveDraft.mockImplementation(
      (_space: string, input: { draft: unknown }) =>
        new Promise((resolve) => {
          finish = resolve;
          // The query layer writes the saved row into the cache before the call returns.
          detail.value = { data: input.draft, status: 'unpublished', design: { version: 1 } };
        }),
    );
    draft.update(recolor(draft.draft.value as ThemeDesign, '#111111'));
    await vi.advanceTimersByTimeAsync(1000);
    draft.update(recolor(draft.draft.value as ThemeDesign, '#222222'));
    await nextTick();
    finish({ version: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(draft.changedElsewhere.value).toBe(false);
    expect(draft.baseVersion.value).toBe(1);
    scope.stop();
  });

  it('flags a newer version saved elsewhere while there are local edits', async () => {
    const { scope, draft } = setup();
    saveDraft.mockImplementation(() => new Promise(() => {}));
    draft.update(recolor(draft.draft.value as ThemeDesign, '#111111'));
    detail.value = { data: defaultTheme(), status: 'unpublished', design: { version: 3 } };
    await nextTick();
    expect(draft.changedElsewhere.value).toBe(true);
    scope.stop();
  });
});
