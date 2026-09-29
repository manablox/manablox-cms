import CheckCard from '@manablox/admin-sdk/components/ui/CheckCard.vue';
import ChipToggle from '@manablox/admin-sdk/components/ui/ChipToggle.vue';
import EmptyState from '@manablox/admin-sdk/components/ui/EmptyState.vue';
import NavList from '@manablox/admin-sdk/components/ui/NavList.vue';
import NavListItem from '@manablox/admin-sdk/components/ui/NavListItem.vue';
import SaveButton from '@manablox/admin-sdk/components/ui/SaveButton.vue';
import SegmentedControl from '@manablox/admin-sdk/components/ui/SegmentedControl.vue';
import StatusBadge from '@manablox/admin-sdk/components/ui/StatusBadge.vue';
import Switch from '@manablox/admin-sdk/components/ui/Switch.vue';
import Tabs from '@manablox/admin-sdk/components/ui/Tabs.vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

const stubs = { Icon: true, RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } };

describe('Switch', () => {
  it('is a switch named by its label and flips on click', async () => {
    const wrapper = mount(Switch, {
      props: { modelValue: false },
      slots: { default: 'Switched off' },
    });
    const control = wrapper.get('[role="switch"]');
    expect(control.attributes('aria-checked')).toBe('false');
    expect(wrapper.get('label').text()).toBe('Switched off');
    await control.trigger('click');
    expect(wrapper.emitted('update:modelValue')).toEqual([[true]]);
  });

  it('does nothing while disabled', async () => {
    const wrapper = mount(Switch, { props: { modelValue: true, disabled: true, ariaLabel: 'On' } });
    await wrapper.get('[role="switch"]').trigger('click');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.get('[role="switch"]').attributes('aria-label')).toBe('On');
  });
});

describe('SegmentedControl', () => {
  it('presses the current option and emits the one clicked', async () => {
    const wrapper = mount(SegmentedControl, {
      props: {
        modelValue: 'grid',
        ariaLabel: 'View',
        options: [
          { value: 'grid', label: 'Tiles' },
          { value: 'table', label: 'Table' },
        ],
      },
      global: { stubs },
    });
    const [tiles, table] = wrapper.findAll('button');
    expect(tiles?.attributes('aria-pressed')).toBe('true');
    expect(table?.attributes('aria-pressed')).toBe('false');
    await table?.trigger('click');
    expect(wrapper.emitted('update:modelValue')).toEqual([['table']]);
  });

  it('emits select on every click, the current option included', async () => {
    const wrapper = mount(SegmentedControl, {
      props: {
        modelValue: 'grid',
        ariaLabel: 'View',
        options: [
          { value: 'grid', label: 'Tiles' },
          { value: 'table', label: 'Table' },
        ],
      },
      global: { stubs },
    });
    await wrapper.findAll('button')[0]?.trigger('click');
    expect(wrapper.emitted('select')).toEqual([['grid']]);
  });
});

describe('Tabs', () => {
  const tabs = [
    { id: 'build', label: 'Steps' },
    { id: 'runs', label: 'Runs' },
  ];
  it('marks the selected tab and moves with the arrow keys', async () => {
    const wrapper = mount(Tabs, { props: { modelValue: 'build', tabs }, global: { stubs } });
    const [build, runs] = wrapper.findAll('[role="tab"]');
    expect(build?.attributes('aria-selected')).toBe('true');
    expect(build?.attributes('tabindex')).toBe('0');
    expect(runs?.attributes('tabindex')).toBe('-1');
    await build?.trigger('keydown', { key: 'ArrowRight' });
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['runs']);
    await build?.trigger('keydown', { key: 'ArrowLeft' });
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['runs']);
    await build?.trigger('keydown', { key: 'End' });
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['runs']);
    await runs?.trigger('keydown', { key: 'Home' });
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['build']);
  });
});

describe('ChipToggle / CheckCard', () => {
  it('are checkboxes under the hood', async () => {
    const chip = mount(ChipToggle, { props: { modelValue: false }, slots: { default: 'Article' } });
    expect(chip.get('label').classes()).not.toContain('mb-badge-brand');
    await chip.get('input').trigger('change');
    expect(chip.emitted('update:modelValue')).toEqual([[true]]);

    const card = mount(CheckCard, {
      props: {
        modelValue: true,
        title: 'Carry on if this fails',
        hint: 'Otherwise the run stops.',
      },
    });
    expect(card.text()).toContain('Otherwise the run stops.');
    await card.get('input').trigger('change');
    expect(card.emitted('update:modelValue')).toEqual([[false]]);
  });
});

describe('EmptyState', () => {
  it('shows the title, the description and the one action', () => {
    const wrapper = mount(EmptyState, {
      props: { title: 'No menus yet', description: 'Create one.', icon: 'menu' },
      slots: { default: '<button>Create menu</button>' },
      global: { stubs },
    });
    expect(wrapper.text()).toContain('No menus yet');
    expect(wrapper.text()).toContain('Create one.');
    expect(wrapper.get('button').text()).toBe('Create menu');
  });
});

describe('NavList', () => {
  it('marks the active row with aria-current, as a page for a link', () => {
    const wrapper = mount(NavList, {
      slots: {
        default: [
          '<NavListItem to="/menus/1" active>Main</NavListItem>',
          '<NavListItem>Footer</NavListItem>',
        ].join(''),
      },
      global: { stubs, components: { NavListItem } },
    });
    const [main, footer] = wrapper.findAll('li > *');
    expect(main?.attributes('aria-current')).toBe('page');
    expect(footer?.attributes('aria-current')).toBeUndefined();
    expect(footer?.element.tagName).toBe('BUTTON');
  });
});

describe('StatusBadge / SaveButton', () => {
  it('spell the vocabulary in lower case and the in-flight verb with an ellipsis', () => {
    expect(mount(StatusBadge, { props: { status: 'read-only' } }).text()).toBe('read only');
    expect(mount(StatusBadge, { props: { status: 'unsaved' } }).classes()).toContain(
      'mb-badge-warn',
    );
    const idle = mount(SaveButton, { props: { saving: false } });
    expect(idle.text()).toBe('Save');
    expect(idle.attributes('disabled')).toBeUndefined();
    const busy = mount(SaveButton, {
      props: { saving: true, label: 'Create role', savingLabel: 'Creating...' },
    });
    expect(busy.text()).toBe('Creating...');
    expect(busy.attributes('disabled')).toBeDefined();
  });
});
