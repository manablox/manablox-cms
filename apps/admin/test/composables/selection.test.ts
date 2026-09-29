import { useSelection } from '@manablox/admin-sdk/composables/useSelection';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';

const ALL = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
const items = ref(ALL);
const mounted: Array<{ unmount: () => void }> = [];

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  items.value = ALL;
});

function harness() {
  let selection!: ReturnType<typeof useSelection<{ id: string }>>;
  const Host = defineComponent({
    setup() {
      const container = ref<HTMLElement | null>(null);
      selection = useSelection({ items, keyOf: (item) => item.id, container });
      return () => h('div', { ref: container });
    },
  });
  const wrapper = mount(Host);
  mounted.push(wrapper);
  return { wrapper, selection };
}

describe('useSelection', () => {
  it('picks one on a plain click, toggles with ctrl and ranges with shift', () => {
    const { selection } = harness();
    selection.select('b', {});
    expect([...selection.selected.value]).toEqual(['b']);
    expect(selection.only.value).toBe('b');
    selection.select('d', { shiftKey: true });
    expect([...selection.selected.value]).toEqual(['b', 'c', 'd']);
    expect(selection.only.value).toBeNull();
    selection.select('c', { ctrlKey: true });
    expect([...selection.selected.value].sort()).toEqual(['b', 'd']);
    selection.select('b', {});
    expect([...selection.selected.value]).toEqual(['b']);
    selection.select('b', {});
    expect(selection.size.value).toBe(0);
  });

  // The shared registry listens on `window`; `mod` is Ctrl off a Mac, as here.
  it('takes everything with Cmd+A and clears with Escape', () => {
    const { selection } = harness();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true }));
    expect(selection.allSelected.value).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(selection.size.value).toBe(0);
  });

  it('drops a selection the list no longer holds', async () => {
    const { selection } = harness();
    selection.selectAll();
    items.value = [{ id: 'a' }, { id: 'c' }];
    await nextTick();
    expect([...selection.selected.value]).toEqual(['a', 'c']);
  });
});
