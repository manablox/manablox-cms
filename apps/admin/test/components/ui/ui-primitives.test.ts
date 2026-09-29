import EntityPanel from '@manablox/admin-sdk/components/layout/EntityPanel.vue';
import Checkbox from '@manablox/admin-sdk/components/ui/Checkbox.vue';
import DataTable from '@manablox/admin-sdk/components/ui/DataTable.vue';
import FormDialog from '@manablox/admin-sdk/components/ui/FormDialog.vue';
import IconPicker from '@manablox/admin-sdk/components/ui/IconPicker.vue';
import JsonBlock from '@manablox/admin-sdk/components/ui/JsonBlock.vue';
import KeyValueList from '@manablox/admin-sdk/components/ui/KeyValueList.vue';
import NumberField from '@manablox/admin-sdk/components/ui/NumberField.vue';
import PageState from '@manablox/admin-sdk/components/ui/PageState.vue';
import Radio from '@manablox/admin-sdk/components/ui/Radio.vue';
import RadioCard from '@manablox/admin-sdk/components/ui/RadioCard.vue';
import SearchField from '@manablox/admin-sdk/components/ui/SearchField.vue';
import SectionIntro from '@manablox/admin-sdk/components/ui/SectionIntro.vue';
import Select from '@manablox/admin-sdk/components/ui/Select.vue';
import SortHeader from '@manablox/admin-sdk/components/ui/SortHeader.vue';
import StringList from '@manablox/admin-sdk/components/ui/StringList.vue';
import { resetShortcuts } from '@manablox/admin-sdk/lib/shortcuts';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref, Transition } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

const stubs = { Icon: true, RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } };

afterEach(() => {
  document.body.innerHTML = '';
  resetShortcuts();
  vi.useRealTimers();
});

const buttonByText = (text: string) =>
  [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === text);

describe('FormDialog', () => {
  function render(props: Record<string, unknown>) {
    return mount(FormDialog, {
      props: { title: 'New thing', ...props },
      slots: { default: '<input name="name" />' },
      attachTo: document.body,
      global: { stubs },
    });
  }

  it('wraps the body in a form whose submit button sits in the footer', async () => {
    const onSubmit = vi.fn();
    const wrapper = render({ submitLabel: 'Create', onSubmit });
    await flushPromises();
    const form = document.querySelector('form') as HTMLFormElement;
    expect(form.querySelector('input[name="name"]')).not.toBeNull();
    const submit = buttonByText('Create') as HTMLButtonElement;
    expect(submit.type).toBe('submit');
    expect(submit.getAttribute('form')).toBe(form.id);
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(onSubmit).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it('shows the busy label while the submit runs and skips a second submit', async () => {
    let finish: (value: boolean) => void = () => {};
    const onSubmit = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)));
    const wrapper = render({ onSubmit, busyLabel: 'Creating...' });
    await flushPromises();
    const form = document.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await nextTick();
    expect(buttonByText('Creating...')?.disabled).toBe(true);
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(onSubmit).toHaveBeenCalledOnce();
    finish(false);
    await flushPromises();
    expect(buttonByText('Save')?.disabled).toBe(false);
    wrapper.unmount();
  });

  it('closes after a submit that resolves true', async () => {
    vi.useFakeTimers();
    const wrapper = render({ onSubmit: () => Promise.resolve(true) });
    await flushPromises();
    (document.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await flushPromises();
    vi.advanceTimersByTime(500);
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });

  it('styles a destructive submit and blocks a disabled one', async () => {
    const onSubmit = vi.fn();
    const wrapper = render({ danger: true, disabled: true, submitLabel: 'Delete', onSubmit });
    await flushPromises();
    const submit = buttonByText('Delete') as HTMLButtonElement;
    expect(submit.className).toContain('mb-btn-danger');
    expect(submit.disabled).toBe(true);
    (document.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    expect(onSubmit).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});

describe('SearchField', () => {
  it('is a labelled search box with the leading icon, sized by `size`', () => {
    const wrapper = mount(SearchField, {
      props: { label: 'Search users', size: 'sm', placeholder: 'Name...' },
      attrs: { class: 'flex-1' },
      global: { stubs },
    });
    const input = wrapper.get('input');
    expect(input.attributes('type')).toBe('search');
    expect(input.classes()).toEqual(
      expect.arrayContaining(['mb-input', 'mb-input-leading', 'mb-input-sm']),
    );
    expect(input.attributes('placeholder')).toBe('Name...');
    expect(wrapper.classes()).toContain('flex-1');
    expect(wrapper.get('.sr-only').text()).toBe('Search users');
  });

  it('emits input at once and the model after the debounce', async () => {
    vi.useFakeTimers();
    const wrapper = mount(SearchField, {
      props: { label: 'Search', modelValue: '', debounce: 200 },
      global: { stubs },
    });
    const input = wrapper.get('input');
    (input.element as HTMLInputElement).value = 'ab';
    await input.trigger('input');
    expect(wrapper.emitted('input')).toEqual([['ab']]);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    vi.advanceTimersByTime(200);
    expect(wrapper.emitted('update:modelValue')).toEqual([['ab']]);
  });

  it('clears at once and follows an outside reset', async () => {
    const wrapper = mount(SearchField, {
      props: { label: 'Search', modelValue: 'old' },
      global: { stubs },
    });
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('old');
    await wrapper.get('input').setValue('');
    expect(wrapper.emitted('update:modelValue')).toEqual([['']]);
    await wrapper.setProps({ modelValue: 'reset' });
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('reset');
  });

  it('binds / to focus the box when asked', async () => {
    const wrapper = mount(SearchField, {
      props: { label: 'Search', shortcut: true },
      attachTo: document.body,
      global: { stubs },
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
    expect(document.activeElement).toBe(wrapper.get('input').element);
    wrapper.unmount();
  });
});

describe('NumberField', () => {
  function render(props: Record<string, unknown> = {}) {
    return mount(NumberField, { props: { label: 'Count', modelValue: 3, ...props } });
  }

  it('is a labelled number input showing the model', () => {
    const wrapper = render({ min: 1, max: 9 });
    const input = wrapper.get('input');
    expect(input.attributes('type')).toBe('number');
    expect(wrapper.get('label').attributes('for')).toBe(input.attributes('id'));
    expect((input.element as HTMLInputElement).value).toBe('3');
    expect(input.attributes('step')).toBe('1');
  });

  it('emits numbers, undefined for empty and nothing for partial input', async () => {
    const wrapper = render({ mode: 'decimal' });
    const input = wrapper.get('input');
    await input.setValue('2.5');
    await input.setValue('');
    await input.setValue('abc');
    expect(wrapper.emitted('update:modelValue')).toEqual([[2.5], [undefined]]);
  });

  it('emits null for empty when nullable and ignores fractions for integers', async () => {
    const wrapper = render({ nullable: true });
    await wrapper.get('input').setValue('1.5');
    await wrapper.get('input').setValue('');
    expect(wrapper.emitted('update:modelValue')).toEqual([[null]]);
  });

  it('clamps to min and max on change', async () => {
    const wrapper = render({ min: 1, max: 5 });
    const input = wrapper.get('input');
    await input.setValue('9');
    await input.trigger('change');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([5]);
    expect((input.element as HTMLInputElement).value).toBe('5');
  });
});

describe('SortHeader', () => {
  it('marks the sorted column and emits its key', async () => {
    const wrapper = mount(SortHeader, {
      props: { by: 'title', sort: { by: 'title', direction: 'asc' }, label: 'Title' },
      global: { stubs },
    });
    expect(wrapper.element.tagName).toBe('TH');
    expect(wrapper.attributes('aria-sort')).toBe('ascending');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('sort')).toEqual([['title']]);
  });

  it('is a columnheader div for grid layouts and says none when unsorted', () => {
    const wrapper = mount(SortHeader, {
      props: { by: 'at', sort: { by: 'title', direction: 'desc' }, label: 'When', tag: 'div' },
      global: { stubs },
    });
    expect(wrapper.attributes('role')).toBe('columnheader');
    expect(wrapper.attributes('aria-sort')).toBe('none');
  });
});

describe('DataTable', () => {
  const items = [
    { id: 'r1', name: 'One' },
    { id: 'r2', name: 'Two' },
  ];
  const columns = [
    { key: 'name', label: 'Name', sortBy: 'name' },
    { key: 'size', label: 'Size' },
  ];

  it('renders headers, cells and data-id rows; a sortable header emits sort', async () => {
    const wrapper = mount(DataTable, {
      props: { items, columns, sort: { by: 'name', direction: 'asc' } },
      slots: { 'cell-size': '<template #cell-size="{ item }">{{ item.id }}-size</template>' },
      global: { stubs },
    });
    const rows = wrapper.findAll('tbody tr');
    expect(rows.map((row) => row.attributes('data-id'))).toEqual(['r1', 'r2']);
    expect(rows[0]?.classes()).toContain('mb-tr-interactive');
    expect(rows[0]?.text()).toContain('One');
    expect(rows[0]?.text()).toContain('r1-size');
    expect(wrapper.get('th[aria-sort]').attributes('aria-sort')).toBe('ascending');
    await wrapper.get('th[aria-sort] button').trigger('click');
    expect(wrapper.emitted('sort')).toEqual([['name']]);
  });

  it('emits rowClick, and navigates with rowTo', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:any(.*)', component: { template: '<div />' } }],
    });
    const push = vi.spyOn(router, 'push');
    const clicked = mount(DataTable, {
      props: { items, columns },
      global: { stubs, plugins: [router] },
    });
    await clicked.get('tbody tr').trigger('click');
    expect(clicked.emitted('rowClick')?.[0]?.[0]).toEqual(items[0]);

    const linked = mount(DataTable, {
      props: { items, columns, rowTo: (item: { id: string }) => `/things/${item.id}` },
      global: { stubs, plugins: [router] },
    });
    await linked.findAll('tbody tr')[1]?.trigger('click');
    expect(push).toHaveBeenCalledWith('/things/r2');
    expect(linked.emitted('rowClick')).toBeUndefined();
  });

  it('adds a checkbox column that selects rows and all', async () => {
    const wrapper = mount(DataTable, {
      props: { items, columns, selectable: true, isSelected: (id: string) => id === 'r1' },
      global: { stubs },
    });
    const rows = wrapper.findAll('tbody tr');
    expect(rows[0]?.classes()).toContain('mb-tr-active');
    expect(rows[0]?.attributes('aria-selected')).toBe('true');
    const all = wrapper.get('thead input[type="checkbox"]');
    expect((all.element as HTMLInputElement).indeterminate).toBe(true);
    await all.setValue(true);
    expect(wrapper.emitted('selectAll')).toHaveLength(1);
    await rows[1]?.get('input[type="checkbox"]').setValue(true);
    expect(wrapper.emitted('rowClick')?.[0]).toEqual([items[1], { ctrlKey: true }]);
  });

  it('shows the AsyncList states', () => {
    const pending = mount(DataTable, {
      props: { items: undefined, columns, pending: true },
      global: { stubs },
    });
    expect(pending.find('table').exists()).toBe(false);
    const empty = mount(DataTable, {
      props: { items: [], columns, emptyTitle: 'No rows' },
      global: { stubs },
    });
    expect(empty.text()).toContain('No rows');
  });
});

describe('SectionIntro', () => {
  it('shows the tile, heading with count, blurb and actions', () => {
    const wrapper = mount(SectionIntro, {
      props: {
        icon: 'menu',
        title: 'Menus in this space',
        count: 2,
        blurb: 'Pick one.',
        tile: 'iris',
      },
      slots: { actions: '<button>New</button>' },
      global: { stubs },
    });
    expect(wrapper.find('.mb-tile-iris').exists()).toBe(true);
    expect(wrapper.get('h2').text()).toContain('Menus in this space');
    expect(wrapper.get('h2 .mb-badge').text()).toBe('2');
    expect(wrapper.get('p').text()).toBe('Pick one.');
    expect(wrapper.get('button').text()).toBe('New');
  });

  it('takes a rich blurb from the default slot', () => {
    const wrapper = mount(SectionIntro, {
      props: { icon: 'database', title: 'Databag types', stacked: true },
      slots: { default: 'See <a href="/databags">Databags</a>.' },
      global: { stubs },
    });
    expect(wrapper.get('p a').attributes('href')).toBe('/databags');
    expect(wrapper.find('.mb-badge').exists()).toBe(false);
  });
});

describe('PageState', () => {
  const global = { stubs: { ...stubs, Loader: true } };

  it('shows the slot once ready', () => {
    const wrapper = mount(PageState, {
      props: { ready: true, loading: true },
      slots: { default: '<p>page</p>' },
      global,
    });
    expect(wrapper.text()).toBe('page');
  });

  it('shows the load error with a retry', async () => {
    const retry = vi.fn();
    const wrapper = mount(PageState, {
      props: { ready: false, error: new Error('Boom'), retry },
      slots: { default: '<p>page</p>' },
      global,
    });
    expect(wrapper.get('[role="alert"]').text()).toContain('Boom');
    await wrapper.get('button').trigger('click');
    expect(retry).toHaveBeenCalledOnce();
  });

  it('shows not found with a way back, and the loader otherwise', () => {
    const missing = mount(PageState, {
      props: {
        notFound: true,
        notFoundTitle: 'Menu not found',
        backTo: '/menus',
        backLabel: 'All menus',
      },
      global,
    });
    expect(missing.text()).toContain('Menu not found');
    expect(missing.get('a').attributes('href')).toBe('/menus');
    const loading = mount(PageState, {
      props: { loading: true },
      slots: { default: 'page' },
      global,
    });
    expect(loading.text()).not.toContain('page');
  });

  it('renders one root element in every state', () => {
    const states: Record<string, unknown>[] = [
      { ready: true },
      { error: new Error('Boom') },
      { notFound: true },
      { loading: true },
    ];
    for (const props of states) {
      const wrapper = mount(PageState, { props, slots: { default: '<p>a</p><p>b</p>' }, global });
      expect((wrapper.vm.$el as Node).nodeType).toBe(Node.ELEMENT_NODE);
    }
  });

  it('mounts as a page root under an out-in transition', async () => {
    const Page = (text: string) =>
      defineComponent({
        render: () => h(PageState, { ready: true }, () => [h('p', text), h('p', 'more')]),
      });
    const pages = { first: Page('first page'), second: Page('second page') };
    const current = ref<keyof typeof pages>('first');
    const wrapper = mount(
      defineComponent({
        render: () => h(Transition, { mode: 'out-in' }, () => h(pages[current.value])),
      }),
      { global: { ...global, stubs: { ...global.stubs, transition: false } } },
    );
    expect(wrapper.text()).toContain('first page');
    current.value = 'second';
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await flushPromises();
    expect(wrapper.text()).toContain('second page');
  });
});

describe('Select', () => {
  it('shows the current label when the options load after mount', async () => {
    const wrapper = mount(Select, {
      props: { modelValue: 'editor', options: [{ value: 'editor', label: 'editor' }] },
      global: { stubs },
    });
    await flushPromises();
    expect(wrapper.get('button').text()).toBe('editor');
    await wrapper.setProps({ options: [{ value: 'editor', label: 'Editor' }] });
    await flushPromises();
    expect(wrapper.get('button').text()).toBe('Editor');
  });

  it('labels null and number values from their own options', async () => {
    const none = mount(Select<string | null>, {
      props: {
        modelValue: null,
        options: [
          { value: null, label: 'None' },
          { value: 'a', label: 'A' },
        ],
      },
      global: { stubs },
    });
    const first = mount(Select<number>, {
      props: {
        modelValue: 0,
        options: [
          { value: 0, label: 'First' },
          { value: 1, label: 'Second' },
        ],
      },
      global: { stubs },
    });
    await flushPromises();
    expect(none.get('button').text()).toBe('None');
    expect(first.get('button').text()).toBe('First');
  });
});

describe('JsonBlock', () => {
  it('pretty-prints and copies the value', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const wrapper = mount(JsonBlock, {
      props: { value: { a: 1 }, label: 'payload' },
      global: { stubs },
    });
    expect(wrapper.get('pre').text()).toBe('{\n  "a": 1\n}');
    await wrapper.get('button[aria-label="Copy payload"]').trigger('click');
    expect(writeText).toHaveBeenCalledWith('{\n  "a": 1\n}');
  });

  it('shows a string as it is', () => {
    const wrapper = mount(JsonBlock, { props: { value: 'plain' }, global: { stubs } });
    expect(wrapper.get('pre').text()).toBe('plain');
  });
});

describe('KeyValueList', () => {
  const value = Object.freeze([Object.freeze({ name: 'x-a', value: '1' })]);

  it('edits, adds and removes pairs as new arrays', async () => {
    const wrapper = mount(KeyValueList, {
      props: {
        modelValue: value as never,
        'onUpdate:modelValue': () => {},
        readOnly: false,
        label: 'Header',
      },
      global: { stubs },
    });
    await wrapper.get('input[aria-label="Header 1: value"]').setValue('2');
    await wrapper.get('button[aria-label="Remove Header 1"]').trigger('click');
    await wrapper.findAll('button').at(-1)?.trigger('click');
    expect(wrapper.emitted('update:modelValue')).toEqual([
      [[{ name: 'x-a', value: '2' }]],
      [[]],
      [
        [
          { name: 'x-a', value: '1' },
          { name: '', value: '' },
        ],
      ],
    ]);
  });

  it('hides editing when read-only', () => {
    const wrapper = mount(KeyValueList, {
      props: { modelValue: [...value], readOnly: true, label: 'Header' },
      global: { stubs },
    });
    expect(wrapper.find('button').exists()).toBe(false);
    expect(wrapper.get('input').attributes('readonly')).toBeDefined();
  });
});

describe('StringList', () => {
  it('adds on Enter and removes a chip, emitting new arrays', async () => {
    const wrapper = mount(StringList, {
      props: {
        modelValue: Object.freeze(['a@x.io']) as never,
        'onUpdate:modelValue': () => {},
        readOnly: false,
        label: 'Recipients',
      },
      global: { stubs },
    });
    const input = wrapper.get('input');
    await input.setValue(' b@x.io ');
    await input.trigger('keydown', { key: 'Enter' });
    await wrapper.get('button[aria-label="Remove a@x.io"]').trigger('click');
    // The parent ignored the add, so the remove works on the original list.
    expect(wrapper.emitted('update:modelValue')).toEqual([[['a@x.io', 'b@x.io']], [[]]]);
  });
});

describe('defineModel primitives', () => {
  it('Checkbox, Radio and RadioCard still emit update:modelValue', async () => {
    const box = mount(Checkbox, { props: { modelValue: false, ariaLabel: 'Pick' } });
    await box.get('input').setValue(true);
    expect(box.emitted('update:modelValue')).toEqual([[true]]);

    const radio = mount(Radio, { props: { modelValue: 'a', value: 'b', name: 'g' } });
    await radio.get('input').trigger('change');
    expect(radio.emitted('update:modelValue')).toEqual([['b']]);

    const card = mount(RadioCard, {
      props: { modelValue: 'b', value: 'b', name: 'g', title: 'B' },
    });
    expect((card.get('input').element as HTMLInputElement).checked).toBe(true);
  });

  it('IconPicker emits the chosen name, and null for none', async () => {
    const wrapper = mount(IconPicker, {
      props: { modelValue: 'doc', names: ['doc', 'menu'] },
      attachTo: document.body,
      global: { stubs },
    });
    await wrapper.get('button').trigger('click');
    await flushPromises();
    buttonByText('No icon')?.click();
    await flushPromises();
    expect(wrapper.emitted('update:modelValue')).toEqual([[null]]);
    wrapper.unmount();
  });
});

describe('EntityPanel', () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:any(.*)', component: { template: '<div />' } }],
  });

  function render(props: Record<string, unknown>) {
    return mount(EntityPanel, {
      props: {
        label: 'Menus',
        to: '/menus',
        panelKey: 'menus',
        icon: 'menu',
        emptyTitle: 'No menus yet',
        emptyDescription: 'Use + to create one.',
        itemTo: (item: { id: string }) => `/menus/${item.id}`,
        ...props,
      },
      global: { stubs: { Icon: true, PanelResizer: true }, plugins: [router] },
    });
  }

  it('shows a query load error with its retry', async () => {
    const refetch = vi.fn();
    const wrapper = render({
      query: {
        data: ref(undefined),
        isPending: ref(false),
        error: ref(new Error('Offline')),
        refetch,
      },
    });
    expect(wrapper.get('[role="alert"]').text()).toContain('Offline');
    await wrapper.get('[role="alert"] button').trigger('click');
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('lists the query rows', () => {
    const wrapper = render({
      query: {
        data: ref([{ id: 'm1' }]),
        isPending: ref(false),
        error: ref(null),
        refetch: () => {},
      },
    });
    expect(wrapper.find('a[href="/menus/m1"]').exists()).toBe(true);
  });

  it('adds a + link or button from createLabel', async () => {
    const linked = render({ items: [], createLabel: 'New menu', createTo: '/menus/new' });
    expect(linked.get('a[aria-label="New menu"]').attributes('href')).toBe('/menus/new');

    const onCreate = vi.fn();
    const button = render({ items: [], createLabel: 'New menu', onCreate });
    await button.get('button[aria-label="New menu"]').trigger('click');
    expect(onCreate).toHaveBeenCalledOnce();

    const hidden = render({ items: [], createLabel: 'New menu', onCreate, canCreate: false });
    expect(hidden.find('[aria-label="New menu"]').exists()).toBe(false);
  });
});

describe('FormDialog in a host', () => {
  it('submits on Enter through the native form', async () => {
    const onSubmit = vi.fn();
    const Host = defineComponent({
      setup: () => () => h(FormDialog, { title: 'T', onSubmit }, () => h('input', { name: 'n' })),
    });
    const wrapper = mount(Host, { attachTo: document.body, global: { stubs } });
    await flushPromises();
    const form = document.querySelector('form') as HTMLFormElement;
    form.requestSubmit();
    expect(onSubmit).toHaveBeenCalledOnce();
    wrapper.unmount();
  });
});
