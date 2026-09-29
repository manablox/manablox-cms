import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@manablox/admin-sdk/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@manablox/admin-sdk/stores/session', () => ({
  useSessionStore: () => ({ revalidate: vi.fn() }),
}));

import { SETTLE_MS, useDraftForm } from '@manablox/admin-sdk/composables/useDraftForm';
import { messageFor, NOT_SAVED } from '@manablox/admin-sdk/lib/messages';
import { toast } from '@manablox/admin-sdk/lib/toast';

const rpcError = (details: unknown[]) =>
  Object.assign(new Error('validation.failed'), { data: { details } });

describe('useDraftForm', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is dirty once the draft differs from the loaded copy and clean again after markSaved', () => {
    const form = useDraftForm<{ name: string }>();
    form.load({ name: 'Main' });
    expect(form.isDirty.value).toBe(false);
    form.draft.value!.name = 'Primary';
    expect(form.isDirty.value).toBe(true);
    form.draft.value!.name = 'Primary!';
    form.markSaved();
    expect(form.isDirty.value).toBe(false);
  });

  it('reads clean again once edited back to the loaded copy', () => {
    const form = useDraftForm<{ name: string; tags: string[] }>();
    form.load({ name: 'Main', tags: ['a'] });
    form.draft.value!.tags.push('b');
    form.draft.value!.name = 'Other';
    form.draft.value!.name = 'Main';
    expect(form.isDirty.value).toBe(true);
    vi.advanceTimersByTime(SETTLE_MS);
    expect(form.isDirty.value).toBe(true);
    form.draft.value!.tags.pop();
    expect(form.isDirty.value).toBe(true);
    vi.advanceTimersByTime(SETTLE_MS);
    expect(form.isDirty.value).toBe(false);
    form.draft.value!.name = 'Again';
    expect(form.isDirty.value).toBe(true);
  });

  it('keeps an edit in progress when the same data is loaded again with keepEdits', () => {
    const form = useDraftForm<{ name: string }>();
    form.load({ name: 'Main' });
    form.draft.value!.name = 'Primary';
    form.load({ name: 'Main' }, { keepEdits: true });
    expect(form.draft.value?.name).toBe('Primary');
    expect(form.isDirty.value).toBe(true);
    form.load({ name: 'Renamed' }, { keepEdits: true });
    expect(form.draft.value?.name).toBe('Renamed');
    expect(form.isDirty.value).toBe(false);
  });

  it('routes a failed submit into field errors and the rest, and reports it once', async () => {
    const form = useDraftForm<{ name: string }>();
    form.load({ name: '' });
    const ok = await form.submit(async () => {
      throw rpcError([
        { key: 'menu.machineName.taken', path: ['machineName'], params: { machineName: 'main' } },
        { key: 'menu.item.targetRequired', path: ['items', 0] },
        { key: 'field.required', path: ['items', 1, 'label'] },
      ]);
    });
    expect(ok).toBe(false);
    expect(form.fieldError(['machineName'])).toContain('already');
    expect(form.fieldError(['name'])).toBeNull();
    expect(form.fieldError(['items', 0])).not.toBeNull();
    expect(form.fieldError(['items', 1, 'label'])).toBe('This is required.');
    expect(form.fieldError(['items', 1])).toBeNull();
    expect(form.fieldError(['items'])).toBeNull();
    expect(form.otherErrors([['machineName'], ['items', 1, 'label']])).toHaveLength(1);
    expect(form.otherErrors((path) => path[0] === 'items' || path[0] === 'machineName')).toEqual(
      [],
    );
    expect(toast.error).toHaveBeenCalledWith(NOT_SAVED);
    expect(form.saving.value).toBe(false);
  });

  it('reports an error with no details by its message and clears old errors on the next try', async () => {
    const form = useDraftForm<{ name: string }>();
    form.load({ name: '' });
    await form.submit(async () => {
      throw rpcError([{ key: 'menu.name.required', path: ['name'] }]);
    });
    expect(form.fieldError(['name'])).not.toBeNull();
    const ok = await form.submit(async () => {
      throw new Error('boom');
    });
    expect(ok).toBe(false);
    expect(form.fieldError(['name'])).toBeNull();
    expect(toast.error).toHaveBeenLastCalledWith(messageFor(new Error('boom')));
  });

  it('toasts a control refusal by its sentence, not as marked errors', async () => {
    const form = useDraftForm<{ name: string }>();
    form.load({ name: 'Header' });
    const error = Object.assign(new Error('control.limit'), {
      data: {
        details: [
          {
            key: 'control.limit',
            path: [],
            params: { limit: 'menusPerSpace', scope: 'space:s1', used: 1, max: 1 },
          },
        ],
      },
    });
    await form.submit(async () => {
      throw error;
    });
    expect(toast.error).toHaveBeenLastCalledWith(
      'The limit of 1 menu per space is reached - remove some before adding more.',
    );
  });

  it('compares through a custom serialiser', () => {
    const form = useDraftForm<{ tags: Set<string> }>({
      serialise: (value) => JSON.stringify([...value.tags].sort()),
    });
    form.load({ tags: new Set(['b', 'a']) });
    form.draft.value = { tags: new Set(['a', 'b']) };
    form.settle();
    expect(form.isDirty.value).toBe(false);
  });

  it('with shallow, counts top-level replacements and ignores nested mutation', () => {
    const form = useDraftForm<{ name: string; nodes: { id: string }[] }>({ shallow: true });
    form.load({ name: 'Flow', nodes: [{ id: 'a' }] });
    form.draft.value!.nodes[0]!.id = 'b';
    form.draft.value!.nodes.push({ id: 'c' });
    expect(form.revision.value).toBe(1);
    expect(form.isDirty.value).toBe(false);
    form.draft.value!.nodes = [{ id: 'a' }];
    expect(form.isDirty.value).toBe(true);
    form.draft.value!.name = 'Other';
    expect(form.revision.value).toBe(3);
  });
});
