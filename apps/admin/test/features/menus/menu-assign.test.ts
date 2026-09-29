import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { placements, setPlacements } = vi.hoisted(() => ({
  placements: vi.fn(),
  setPlacements: vi.fn(),
}));
vi.mock('@manablox/admin-sdk/lib/api', () => ({ api: { menus: { placements, setPlacements } } }));
vi.mock('@manablox/admin-sdk/stores/space', () => ({
  useSpaceStore: () => ({ currentId: 's1', locale: 'en' }),
}));

import { queryClient } from '@manablox/admin-sdk/lib/query-client';
import MenuAssignDialog from '~/features/menus/components/MenuAssignDialog.vue';

const menu = (id: string, name: string) => ({
  id,
  spaceId: 's1',
  name,
  machineName: name.toLowerCase(),
  description: null,
});

/** "Main" holds the document at the top level; "Footer" has two entries and does not. */
const options = [
  {
    menu: menu('m1', 'Main'),
    entries: [
      { id: 'i1', label: 'Home', depth: 0, parentId: null, isSelf: false },
      { id: 'i2', label: 'About', depth: 0, parentId: null, isSelf: true },
    ],
    placement: { parentId: null, index: 1 },
  },
  {
    menu: menu('m2', 'Footer'),
    entries: [
      { id: 'i3', label: 'Legal', depth: 0, parentId: null, isSelf: false },
      { id: 'i4', label: 'Imprint', depth: 1, parentId: 'i3', isSelf: false },
    ],
    placement: null,
  },
];

async function render() {
  const wrapper = mount(MenuAssignDialog, {
    props: { localizationId: 'loc1', title: 'About' },
    attachTo: document.body,
  });
  await vi.waitUntil(() => document.querySelectorAll('input[type="checkbox"]').length === 2);
  return wrapper;
}

const boxes = () => [...document.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];

function click(box: HTMLInputElement, checked: boolean) {
  box.checked = checked;
  box.dispatchEvent(new Event('change', { bubbles: true }));
}

const save = () =>
  [...document.querySelectorAll('button')]
    .find((button) => button.textContent?.includes('Save menus'))
    ?.click();

beforeEach(() => {
  queryClient.clear();
  placements.mockReset().mockResolvedValue(options);
  setPlacements.mockReset().mockResolvedValue([]);
});

describe('MenuAssignDialog', () => {
  it('ticks the menus the document is in already', async () => {
    const wrapper = await render();
    expect(boxes().map((box) => box.checked)).toEqual([true, false]);
    wrapper.unmount();
  });

  it('adds the document to a menu, after its existing top-level entries', async () => {
    const wrapper = await render();
    click(boxes()[1] as HTMLInputElement, true);
    await new Promise((resolve) => setTimeout(resolve));
    save();

    await vi.waitUntil(() => setPlacements.mock.calls.length > 0);
    expect(setPlacements).toHaveBeenCalledWith({
      spaceId: 's1',
      localizationId: 'loc1',
      // "Legal" is the only top-level entry of the footer; "Imprint" is nested under it.
      placements: [
        { menuId: 'm1', parentId: null, index: 1 },
        { menuId: 'm2', parentId: null, index: 1 },
      ],
    });
    wrapper.unmount();
  });

  it('sends an empty list when every menu is unticked', async () => {
    const wrapper = await render();
    click(boxes()[0] as HTMLInputElement, false);
    await new Promise((resolve) => setTimeout(resolve));
    save();

    await vi.waitUntil(() => setPlacements.mock.calls.length > 0);
    expect(setPlacements).toHaveBeenCalledWith({
      spaceId: 's1',
      localizationId: 'loc1',
      placements: [],
    });
    wrapper.unmount();
  });
});
