import Checkbox from '@manablox/admin-sdk/components/ui/Checkbox.vue';
import FormField from '@manablox/admin-sdk/components/ui/FormField.vue';
import Radio from '@manablox/admin-sdk/components/ui/Radio.vue';
import RadioCard from '@manablox/admin-sdk/components/ui/RadioCard.vue';
import TextareaField from '@manablox/admin-sdk/components/ui/TextareaField.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

describe('FormField', () => {
  it('labels the control through a generated id', () => {
    const wrapper = mount(FormField, {
      props: { label: 'Name' },
      slots: { default: '<template #default="{ id }"><input :id="id" /></template>' },
    });
    const id = wrapper.get('input').attributes('id');
    expect(id).toBeTruthy();
    expect(wrapper.get('label').attributes('for')).toBe(id);
    expect(wrapper.get('label').classes()).toContain('mb-label');
  });

  it('keeps a given id and marks a required field', () => {
    const wrapper = mount(FormField, {
      props: { id: 'field-f1', label: 'Title', required: true },
      slots: { default: '<template #default="{ id }"><input :id="id" /></template>' },
    });
    expect(wrapper.get('input').attributes('id')).toBe('field-f1');
    expect(wrapper.get('label').text()).toBe('Title *');
  });

  it('shows the hint and the error under the control', () => {
    const wrapper = mount(FormField, {
      props: { label: 'Slug', hint: 'From the title.', error: 'Already taken.' },
      slots: { default: '<input />' },
    });
    expect(wrapper.get('.mb-hint').text()).toBe('From the title.');
    expect(wrapper.get('.mb-error').text()).toBe('Already taken.');
  });

  it('renders no error element while the error is empty', () => {
    const wrapper = mount(FormField, {
      props: { label: 'Slug', error: null },
      slots: { default: '<input />' },
    });
    expect(wrapper.find('.mb-error').exists()).toBe(false);
    expect(wrapper.find('label').exists()).toBe(true);
  });

  it('puts the actions slot next to the label', () => {
    const wrapper = mount(FormField, {
      props: { label: 'Body' },
      slots: { default: '<input />', actions: '<button>AI</button>' },
    });
    expect(wrapper.get('label').text()).toBe('Body');
    expect(wrapper.get('button').text()).toBe('AI');
  });
});

describe('TextField / TextareaField', () => {
  it('is an mb-input with the attributes and classes passed through', async () => {
    const wrapper = mount(TextField, {
      props: { modelValue: 'a', label: 'Name' },
      attrs: { class: 'mb-input-mono', placeholder: 'Blogger', required: '' },
    });
    const input = wrapper.get('input');
    expect(input.classes()).toEqual(expect.arrayContaining(['mb-input', 'mb-input-mono']));
    expect(input.attributes('placeholder')).toBe('Blogger');
    expect(input.attributes('required')).toBeDefined();
    expect(wrapper.get('label').attributes('for')).toBe(input.attributes('id'));
    await input.setValue('ab');
    expect(wrapper.emitted('update:modelValue')).toEqual([['ab']]);
  });

  it('emits numbers for a number input', async () => {
    const wrapper = mount(TextField, {
      props: { modelValue: 1, label: 'Position' },
      attrs: { type: 'number' },
    });
    await wrapper.get('input').setValue('12');
    expect(wrapper.emitted('update:modelValue')).toEqual([[12]]);
  });

  it('passes the error through', () => {
    const wrapper = mount(TextField, {
      props: { modelValue: '', label: 'Email', error: 'Taken.' },
    });
    expect(wrapper.get('.mb-error').text()).toBe('Taken.');
  });

  it('renders a textarea that grows from its own classes', async () => {
    const wrapper = mount(TextareaField, {
      props: { modelValue: '', label: 'Prompt' },
      attrs: { class: 'min-h-28', rows: '3' },
    });
    const area = wrapper.get('textarea');
    expect(area.classes()).toEqual(expect.arrayContaining(['mb-input', 'min-h-28']));
    expect(area.attributes('rows')).toBe('3');
    await area.setValue('Write it');
    expect(wrapper.emitted('update:modelValue')).toEqual([['Write it']]);
  });
});

describe('Checkbox / Radio / RadioCard', () => {
  it('names a checkbox by its slot, or by aria-label without one', async () => {
    const labelled = mount(Checkbox, {
      props: { modelValue: false },
      slots: { default: 'Publishable' },
    });
    expect(labelled.get('label').text()).toBe('Publishable');
    await labelled.get('input').setValue(true);
    expect(labelled.emitted('update:modelValue')).toEqual([[true]]);

    const bare = mount(Checkbox, {
      props: { modelValue: true, ariaLabel: 'Select all', indeterminate: true },
    });
    expect(bare.element.tagName).toBe('INPUT');
    expect(bare.attributes('aria-label')).toBe('Select all');
    expect((bare.element as HTMLInputElement).indeterminate).toBe(true);
  });

  it('checks the radio whose value matches and emits its value', async () => {
    const wrapper = mount(Radio, {
      props: { modelValue: false, value: true, name: 'restrict' },
      slots: { default: 'Only these' },
    });
    const input = wrapper.get('input');
    expect(input.attributes('type')).toBe('radio');
    expect((input.element as HTMLInputElement).checked).toBe(false);
    await input.trigger('change');
    expect(wrapper.emitted('update:modelValue')).toEqual([[true]]);
  });

  it('highlights the chosen card', () => {
    const chosen = mount(RadioCard, {
      props: {
        modelValue: 'basic',
        value: 'basic',
        name: 'setup',
        title: 'Basic setup',
        hint: 'A tree.',
      },
    });
    expect(chosen.get('label').classes()).toContain('border-brand-500');
    expect(chosen.text()).toContain('A tree.');
    const other = mount(RadioCard, {
      props: { modelValue: 'basic', value: 'empty', name: 'setup', title: 'Empty space' },
    });
    expect(other.get('label').classes()).not.toContain('border-brand-500');
  });
});
