import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';

const space = vi.hoisted(() => ({ currentId: 's1' as string | null }));
const grants = vi.hoisted(() => ({ list: ['menu:write', 'content:read:t1'] }));
const leave = vi.hoisted(() => ({ guard: null as null | (() => unknown) }));
const crumb = vi.hoisted(() => ({ leaf: null as unknown }));

vi.mock('@manablox/admin-sdk/stores/space', () => ({ useSpaceStore: () => space }));
vi.mock('@manablox/admin-sdk/stores/session', () => ({
  useSessionStore: () => ({
    can: (permission: string, spaceId: string | null, typeId?: string | null) =>
      spaceId === 's1' &&
      (grants.list.includes(permission) ||
        (typeId ? grants.list.includes(`${permission}:${typeId}`) : false)),
  }),
}));
vi.mock('vue-router', () => ({
  onBeforeRouteLeave: (guard: () => unknown) => {
    leave.guard = guard;
  },
}));
vi.mock('@manablox/admin-sdk/composables/useBreadcrumb', () => ({
  useBreadcrumb: (leaf: () => unknown) => {
    crumb.leaf = leaf;
  },
}));

import { useEditorForm } from '@manablox/admin-sdk/composables/useEditorForm';
import { ariaSort, nextSort, useSort } from '@manablox/admin-sdk/composables/useSort';
import { pending, settle } from '@manablox/admin-sdk/lib/confirm';
import { resetShortcuts, shortcutHint } from '@manablox/admin-sdk/lib/shortcuts';
import { requireSpace, useCan } from '@manablox/admin-sdk/lib/space';

beforeEach(() => {
  space.currentId = 's1';
  resetShortcuts();
});

describe('shortcutHint', () => {
  it('writes keys as plain text, with an optional label', () => {
    // happy-dom reports a non-Mac platform.
    expect(shortcutHint('n')).toBe('N');
    expect(shortcutHint('mod+enter')).toBe('Ctrl+Enter');
    expect(shortcutHint('alt+n')).toBe('Alt+N');
    expect(shortcutHint('g c')).toBe('G then C');
    expect(shortcutHint('n', 'New menu')).toBe('New menu (N)');
  });
});

describe('useSort', () => {
  it('flips the current column and starts another at its first direction', () => {
    const { sort, toggle } = useSort<'title' | 'at'>({ by: 'at', direction: 'desc' }, (by) =>
      by === 'at' ? 'desc' : 'asc',
    );
    toggle('at');
    expect(sort.value).toEqual({ by: 'at', direction: 'asc' });
    toggle('title');
    expect(sort.value).toEqual({ by: 'title', direction: 'asc' });
    expect(nextSort(sort.value, 'at')).toEqual({ by: 'at', direction: 'asc' });
  });

  it('names the aria-sort state', () => {
    const sort = { by: 'title', direction: 'desc' } as const;
    expect(ariaSort(sort, 'title')).toBe('descending');
    expect(ariaSort(sort, 'at' as 'title')).toBe('none');
  });
});

describe('requireSpace and useCan', () => {
  it('returns the current space or throws', () => {
    expect(requireSpace()).toBe('s1');
    space.currentId = null;
    expect(() => requireSpace()).toThrow('No space selected');
  });

  it('checks a permission in the current space, optionally for a type', () => {
    expect(useCan('menu:write').value).toBe(true);
    expect(useCan('workflow:write').value).toBe(false);
    expect(useCan('content:read', 't1').value).toBe(true);
    expect(useCan('content:read', () => 't2').value).toBe(false);
  });
});

describe('useEditorForm', () => {
  interface Draft {
    name: string;
    items: string[];
  }

  function setup() {
    const source = ref<{ title: string; list: string[] } | null>(null);
    const save = vi.fn();
    let form!: ReturnType<typeof useEditorForm<{ title: string; list: string[] }, Draft>>;
    const Host = defineComponent({
      setup() {
        form = useEditorForm({
          source,
          toDraft: (loaded) => ({ name: loaded.title, items: [...loaded.list] }),
          what: 'This menu',
          crumb: (draft) => draft.name,
          save,
          inline: ['name'],
          shallow: true,
        });
        return () => null;
      },
    });
    const wrapper = mount(Host, { attachTo: document.body });
    return { source, save, form: () => form, wrapper };
  }

  it('loads the draft from the source and keeps edits over an identical refetch', async () => {
    const { source, form } = setup();
    expect(form().draft.value).toBeNull();
    source.value = { title: 'Main', list: ['a'] };
    await nextTick();
    expect(form().draft.value).toEqual({ name: 'Main', items: ['a'] });
    (form().draft.value as Draft).name = 'Edited';
    expect(form().isDirty.value).toBe(true);
    source.value = { title: 'Main', list: ['a'] };
    await nextTick();
    expect(form().draft.value?.name).toBe('Edited');
    source.value = { title: 'Renamed', list: [] };
    await nextTick();
    expect(form().draft.value).toEqual({ name: 'Renamed', items: [] });
  });

  it('sets the crumb, binds Mod+S and guards leaving with unsaved edits', async () => {
    const { source, save, form } = setup();
    source.value = { title: 'Main', list: [] };
    await nextTick();
    expect((crumb.leaf as () => unknown)()).toBe('Main');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
    expect(save).toHaveBeenCalledOnce();
    await expect(leave.guard?.()).resolves.toBe(true);
    (form().draft.value as Draft).name = 'Edited';
    const leaving = leave.guard?.();
    await nextTick();
    expect(pending.value?.message).toBe(
      'This menu has unsaved changes. Leaving now discards them.',
    );
    settle(false);
    await expect(leaving).resolves.toBe(false);
  });

  it('lists errors without an inline input', () => {
    const { form } = setup();
    form().errors.value = [
      { key: 'validation.required', path: ['name'] },
      { key: 'validation.required', path: ['items', 0] },
    ] as never;
    expect(form().otherErrors.value).toHaveLength(1);
  });
});
