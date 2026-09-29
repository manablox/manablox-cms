import AsyncList from '@manablox/admin-sdk/components/ui/AsyncList.vue';
import Panel from '@manablox/admin-sdk/components/ui/Panel.vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

const stubs = { Icon: true };

describe('Panel', () => {
  it('is a card with a title row, a spacer and the actions', () => {
    const wrapper = mount(Panel, {
      props: { title: 'API keys' },
      slots: { default: '<p>body</p>', actions: '<button>Issue key</button>' },
    });
    expect(wrapper.element.tagName).toBe('SECTION');
    expect(wrapper.classes()).toContain('mb-card');
    const heading = wrapper.get('h2');
    expect(heading.text()).toBe('API keys');
    expect(heading.classes()).toEqual(expect.arrayContaining(['text-base', 'font-bold']));
    expect(wrapper.find('.flex-1').exists()).toBe(true);
    expect(wrapper.get('button').text()).toBe('Issue key');
    expect(wrapper.get('p').text()).toBe('body');
  });

  it('can be a plain block with a small h3 and a count badge', () => {
    const wrapper = mount(Panel, {
      props: { title: 'Members', size: 'sm', heading: 'h3', card: false, count: 3 },
    });
    expect(wrapper.element.tagName).toBe('DIV');
    expect(wrapper.classes()).not.toContain('mb-card');
    expect(wrapper.get('h3').classes()).toContain('text-sm');
    expect(wrapper.get('.mb-badge').text()).toBe('3');
  });

  it('puts a description under the title', () => {
    const wrapper = mount(Panel, {
      props: { title: 'Credentials', description: 'What a workflow signs in with.', size: 'lg' },
    });
    expect(wrapper.get('h2').classes()).toContain('text-lg');
    expect(wrapper.text()).toContain('What a workflow signs in with.');
  });
});

describe('AsyncList', () => {
  const item = '<template #item="{ item }"><span class="row">{{ item.name }}</span></template>';

  it('shows skeleton rows while pending', () => {
    const wrapper = mount(AsyncList, {
      props: { pending: true, items: undefined, rows: 3 },
      slots: { item },
      global: { stubs },
    });
    expect(wrapper.findAll('.mb-skeleton')).toHaveLength(3);
    expect(wrapper.find('.row').exists()).toBe(false);
  });

  it('shows a retry after a failure and calls it', async () => {
    let retried = 0;
    const wrapper = mount(AsyncList, {
      props: {
        pending: false,
        items: undefined,
        error: new Error('nope'),
        retry: () => {
          retried += 1;
        },
      },
      slots: { item },
      global: { stubs },
    });
    expect(wrapper.get('[role="alert"]').text()).toContain('Try again');
    await wrapper.get('button').trigger('click');
    expect(retried).toBe(1);
  });

  it('shows the empty state, with the given actions, when there are no items', () => {
    const wrapper = mount(AsyncList, {
      props: { pending: false, items: [], emptyTitle: 'No keys yet', emptyIcon: 'key' },
      slots: { item, 'empty-actions': '<button>Create</button>' },
      global: { stubs },
    });
    expect(wrapper.get('.mb-empty-title').text()).toBe('No keys yet');
    expect(wrapper.get('button').text()).toBe('Create');
  });

  it('lets the empty slot replace the empty state', () => {
    const wrapper = mount(AsyncList, {
      props: { pending: false, items: [] },
      slots: { item, empty: '<p class="mb-hint">None.</p>' },
      global: { stubs },
    });
    expect(wrapper.get('.mb-hint').text()).toBe('None.');
    expect(wrapper.find('.mb-empty').exists()).toBe(false);
  });

  it('renders a divided list of rows keyed by id', () => {
    const wrapper = mount(AsyncList, {
      props: {
        pending: false,
        items: [
          { id: 'a', name: 'One' },
          { id: 'b', name: 'Two' },
        ],
        listClass: 'text-sm',
        itemClass: 'py-2',
      },
      slots: { item },
      global: { stubs },
    });
    const list = wrapper.get('ul');
    expect(list.classes()).toEqual(expect.arrayContaining(['mb-list-divided', 'text-sm']));
    expect(list.findAll('li').map((li) => li.text())).toEqual(['One', 'Two']);
    expect(list.get('li').classes()).toContain('py-2');
  });

  it('hands the items to the default slot for other layouts', () => {
    const wrapper = mount(AsyncList, {
      props: { pending: false, items: [{ id: 'a' }, { id: 'b' }] },
      slots: { default: '<template #default="{ items }"><i>{{ items.length }}</i></template>' },
      global: { stubs },
    });
    expect(wrapper.get('i').text()).toBe('2');
    expect(wrapper.find('ul').exists()).toBe(false);
  });
});
