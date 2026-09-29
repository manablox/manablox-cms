import type { ContentTypeSummary } from '@manablox/admin-sdk/lib/api-types';
import { type FieldContext, provideFieldContext } from '@manablox/admin-sdk/lib/field-context';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import FieldRenderer from '~/components/FieldRenderer.vue';
import BlocksField from '~/components/fields/BlocksField.vue';

const blockType = {
  id: 't1',
  name: 'section',
  label: 'Section',
  kind: 'block',
  fields: [],
} as unknown as ContentTypeSummary;

const base = {
  required: false,
  localized: false,
  unique: false,
  admin: { zone: 'main' as const, width: 100, position: 0 },
};
const stringField = {
  ...base,
  id: 'f1',
  name: 'title',
  label: 'Title',
  type: 'string',
  settings: {},
};
const blocksField = {
  ...base,
  id: 'f2',
  name: 'body',
  label: 'Body',
  type: 'blocks',
  settings: { types: ['t1'] },
};
const blocksValue = { blocks: [{ blockId: 'b1', type: 't1', fields: {} }] };

function context(readOnly: boolean): FieldContext {
  return {
    spaceId: 's1',
    locale: 'en',
    errorFor: () => null,
    errorUnder: () => false,
    readOnly,
    typeById: (id) => (id === 't1' ? blockType : null),
    typeByName: () => null,
    blockTypes: () => [blockType],
    fieldTypeMeta: () => null,
  };
}

/** A component under a stub editor context. */
function render(readOnly: boolean, component: unknown, props: Record<string, unknown>) {
  const Host = defineComponent({
    setup() {
      provideFieldContext(context(readOnly));
      return () => h(component as never, props);
    },
  });
  return mount(Host, { global: { stubs: { Icon: true } } });
}

describe('read-only field editing', () => {
  it('disables the input of a read-only field', async () => {
    const wrapper = render(true, FieldRenderer, {
      field: stringField,
      modelValue: 'x',
      path: ['title'],
    });
    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined();
    await vi.waitFor(() => wrapper.get('input#field-f1'), { timeout: 10_000 });
    // happy-dom does not apply fieldset disabling; browsers disable every control inside.
    expect(wrapper.get('fieldset').element.contains(wrapper.get('input#field-f1').element)).toBe(
      true,
    );
  });

  it('leaves the input of a writable field enabled', () => {
    const wrapper = render(false, FieldRenderer, {
      field: stringField,
      modelValue: 'x',
      path: ['title'],
    });
    expect(wrapper.get('fieldset').attributes('disabled')).toBeUndefined();
  });

  it('keeps a blocks field browsable: nested fields disable themselves', () => {
    const wrapper = render(true, FieldRenderer, {
      field: blocksField,
      modelValue: blocksValue,
      path: ['body'],
    });
    expect(wrapper.get('fieldset').attributes('disabled')).toBeUndefined();
  });

  it('hides adding, moving and removing blocks but still opens them', async () => {
    const props = {
      field: blocksField,
      settings: blocksField.settings,
      modelValue: blocksValue,
      path: ['body'],
    };
    const writable = render(false, BlocksField, props);
    expect(writable.find('[aria-label="Delete block"]').exists()).toBe(true);
    expect(writable.text()).toContain('Add Section');

    const readOnly = render(true, BlocksField, props);
    expect(readOnly.find('[aria-label="Delete block"]').exists()).toBe(false);
    expect(readOnly.find('[aria-label="Move up"]').exists()).toBe(false);
    expect(readOnly.find('[draggable="true"]').exists()).toBe(false);
    expect(readOnly.text()).not.toContain('Add Section');
    expect(readOnly.text()).not.toContain('Use a grid');

    await readOnly.get('button.text-left').trigger('click');
    expect(readOnly.find('[data-block-panel="b1"]').exists()).toBe(true);
  });
});
