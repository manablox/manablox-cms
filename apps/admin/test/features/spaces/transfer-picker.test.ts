import { mount } from '@vue/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import TransferPicker from '~/features/spaces/components/TransferPicker.vue';
import {
  describeCounts,
  everything,
  inventoryFrom,
  sectionsIn,
  type TransferInventory,
  type TransferSection,
  type TransferSelection,
  transferPayload,
} from '~/features/spaces/transfer-sections';
import { registerTransferSection, resetPluginRegistry } from '~/lib/plugins/registry';

const inventory: TransferInventory = {
  contentTypes: [{ id: 'type-1', label: 'Article' }],
  contents: {
    total: 3,
    types: [{ id: 'type-1', label: 'Article', count: 3 }],
    locales: [
      { id: 'de', label: 'de', count: 1 },
      { id: 'en', label: 'en', count: 2 },
    ],
    statuses: [
      { id: 'draft', label: 'draft', count: 1 },
      { id: 'published', label: 'published', count: 2 },
    ],
  },
  assets: 4,
  menus: [
    { id: 'menu-1', label: 'Main' },
    { id: 'menu-2', label: 'Footer' },
  ],
  roles: [],
  credentials: [],
  redirects: 0,
  plugins: {},
  pluginEntries: {},
};

const available: TransferSection[] = ['contents', 'history', 'menus'];

function picker(selection: TransferSelection = everything(available)) {
  const wrapper = mount(TransferPicker, {
    props: { inventory, available, modelValue: selection },
  });
  /** The picker's last emitted selection. */
  const emitted = () => (wrapper.emitted('update:modelValue')?.at(-1) as [TransferSelection])[0];
  return { wrapper, emitted };
}

/** Expands a row via its count button. */
async function open(wrapper: ReturnType<typeof picker>['wrapper'], label: string) {
  const row = wrapper.findAll('li').find((item) => item.text().includes(label));
  await row?.find('button')?.trigger('click');
  return row;
}

describe('TransferPicker', () => {
  it('groups the available sections and says what the space holds of each', () => {
    const { wrapper } = picker();
    const text = wrapper.text();
    // Content first, then its structure.
    expect(text).toContain('Content');
    expect(text).toContain('Model and structure');
    expect(text).not.toContain('Integrations');
    expect(text).toContain('Documents');
    expect(text).not.toContain('Asset records');
    // Counts come from the inventory.
    expect(wrapper.find('li')?.text()).toContain('3');
  });

  it('drops a section and the one that hangs off it', async () => {
    const { wrapper, emitted } = picker();
    await wrapper.findAll('input[type="checkbox"]')[0]?.trigger('change');
    // History belongs to documents, so unticking them drops it.
    expect(emitted().sections).toEqual(['menus']);
  });

  it('turns a whole group on and off from its own header', async () => {
    const { wrapper, emitted } = picker();
    // Everything is on, so the first group's toggle reads None.
    const [contentGroup] = wrapper.findAll('section');
    expect(contentGroup?.find('button').text()).toBe('None');
    await contentGroup?.find('button').trigger('click');
    expect(emitted().sections).toEqual(['menus']);
  });

  it('narrows a section to the entries that stay ticked, and back again', async () => {
    const { wrapper, emitted } = picker();
    const row = await open(wrapper, 'Menus');
    await row?.findAll('input[type="checkbox"]').at(-1)?.trigger('change');
    expect(emitted().ids.menus).toEqual(['menu-1']);

    // The whole section is omitted from the payload.
    const { wrapper: second, emitted: secondEmitted } = picker(emitted());
    const reopened = await open(second, 'Menus');
    await reopened?.findAll('input[type="checkbox"]').at(-1)?.trigger('change');
    expect(secondEmitted().ids.menus).toBeUndefined();
    expect(transferPayload(secondEmitted()).ids).toBeUndefined();
  });

  it('filters the documents by status', async () => {
    const { wrapper, emitted } = picker();
    const row = await open(wrapper, 'Documents');
    // Types, then locales, then statuses: the last chip is `published`.
    await row?.findAll('input[type="checkbox"]').at(-1)?.trigger('change');
    expect(emitted().contents.statuses).toEqual(['draft']);
    expect(transferPayload(emitted()).contents).toEqual({ statuses: ['draft'] });
  });
});

describe('inventoryFrom', () => {
  it('reads the same inventory out of an export file', () => {
    const held = inventoryFrom({
      contentTypes: [{ id: 'type-1', label: 'Article' }],
      contents: [
        { id: 'a', typeId: 'type-1', locale: 'en', status: 'published' },
        { id: 'b', typeId: 'type-1', locale: 'de', status: 'draft' },
      ],
      assets: [{ id: 'asset-1' }],
      menus: [{ id: 'menu-1', name: 'Main' }],
      credentials: [{ id: 'cred-1', kind: 'smtp' }],
    });

    expect(held.contents.total).toBe(2);
    expect(held.contents.types).toEqual([{ id: 'type-1', label: 'Article', count: 2 }]);
    expect(held.contents.statuses.map((s) => s.id)).toEqual(['draft', 'published']);
    expect(held.assets).toBe(1);
    expect(held.menus).toEqual([{ id: 'menu-1', label: 'Main' }]);
    // An entry without a name shows its kind.
    expect(held.credentials).toEqual([{ id: 'cred-1', label: 'smtp' }]);
    expect(held.roles).toEqual([]);
    expect(held.plugins).toEqual({});
    expect(held.pluginEntries).toEqual({});
  });

  describe('with a pickable plugin section', () => {
    beforeAll(() =>
      registerTransferSection({
        kind: 'hello.greetings',
        group: 'content',
        icon: 'chat',
        label: 'Greetings',
        description: 'Greetings.',
        pickable: true,
      }),
    );
    afterAll(() => resetPluginRegistry());

    it("lists a file's entries by id and narrows the section to the ticked ones", async () => {
      const held = inventoryFrom({
        sections: ['hello.greetings'],
        plugins: {
          'hello.greetings': [{ id: 'g1', message: 'Hi' }, { id: 'g2', name: 'Hey' }, {}],
        },
      });
      expect(held.plugins['hello.greetings']).toBe(3);
      expect(held.pluginEntries['hello.greetings']).toEqual([
        { id: 'g1', label: 'Entry 1' },
        { id: 'g2', label: 'Hey' },
      ]);

      const wrapper = mount(TransferPicker, {
        props: {
          inventory: held,
          available: ['hello.greetings'],
          modelValue: everything(['hello.greetings']),
        },
      });
      const row = await open(wrapper, 'Greetings');
      await row?.findAll('input[type="checkbox"]').at(-1)?.trigger('change');
      const emitted = (wrapper.emitted('update:modelValue')?.at(-1) as [TransferSelection])[0];
      expect(transferPayload(emitted).ids).toEqual({ 'hello.greetings': ['g1'] });
    });
  });

  describe("with a plugin's sections", () => {
    beforeAll(() => {
      const group = { id: 'site', label: 'Designed site', hint: 'How it looks', order: 300 };
      registerTransferSection({
        kind: 'website.designs',
        group,
        icon: 'palette',
        label: 'Site designs',
        description: 'Designs.',
        noun: ['site design', 'site designs'],
      });
      registerTransferSection({
        kind: 'website.domains',
        group: 'site',
        icon: 'globe',
        label: 'Domains',
        description: 'Host names.',
        optIn: true,
        noun: ['domain', 'domains'],
      });
    });
    afterAll(() => resetPluginRegistry());

    it('reads data provider sections under plugins, leaving domains unticked until picked', () => {
      const file = {
        sections: ['redirects', 'website.designs', 'website.domains'],
        redirects: [{ fromPath: '/a' }],
        plugins: {
          'website.designs': [{ kind: 'theme', key: 'default' }],
          'website.domains': [{ hostname: 'example.com' }],
        },
      };
      const held = sectionsIn(file);
      expect([...held]).toEqual([
        ['redirects', 1],
        ['website.designs', 1],
        ['website.domains', 1],
      ]);
      expect(inventoryFrom(file)).toMatchObject({
        redirects: 1,
        plugins: { 'website.designs': 1, 'website.domains': 1 },
      });
      expect(everything([...held.keys()]).sections).toEqual(['redirects', 'website.designs']);
      expect(describeCounts({ 'website.designs': 1, redirects: 2 })).toBe(
        '2 redirects, 1 site design',
      );
    });
  });
});
