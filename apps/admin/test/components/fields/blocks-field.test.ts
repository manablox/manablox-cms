import type { ContentTypeSummary } from '@manablox/admin-sdk/lib/api-types';
import { type FieldContext, provideFieldContext } from '@manablox/admin-sdk/lib/field-context';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import BlocksField from '~/components/fields/BlocksField.vue';

const blockType = {
  id: 't1',
  name: 'section',
  label: 'Section',
  kind: 'block',
  fields: [],
} as unknown as ContentTypeSummary;

const field = {
  id: 'f1',
  name: 'body',
  label: 'Body',
  type: 'blocks',
  settings: { types: ['t1'] },
  required: false,
  localized: false,
  unique: false,
  admin: { zone: 'main' as const, width: 100, position: 0 },
};

const value = {
  blocks: [
    { blockId: 'b1', type: 't1', fields: {} },
    { blockId: 'b2', type: 't1', fields: {} },
  ],
};

/** The field under a stub editor context, as a document's `body`. */
function render(context: Partial<FieldContext>) {
  const Host = defineComponent({
    setup() {
      provideFieldContext({
        spaceId: 's1',
        locale: 'en',
        errorFor: () => null,
        errorUnder: () => false,
        readOnly: false,
        typeById: (id) => (id === 't1' ? blockType : null),
        typeByName: () => null,
        blockTypes: () => [blockType],
        fieldTypeMeta: () => null,
        ...context,
      });
      return () =>
        h(BlocksField, { field, settings: field.settings, modelValue: value, path: ['body'] });
    },
  });
  return mount(Host);
}

describe('BlocksField', () => {
  it('marks the block the save was refused over and opens it', () => {
    const wrapper = render({ errorUnder: (path) => path.join('.') === 'body.1' });
    const marked = wrapper.findAll('[data-invalid]');
    expect(marked).toHaveLength(1);
    // Its panel is open without anyone clicking.
    expect(wrapper.find('[data-block-panel="b2"]').exists()).toBe(true);
    expect(wrapper.find('[data-block-panel="b1"]').exists()).toBe(false);
  });

  it('leaves every block alone when nothing failed', () => {
    const wrapper = render({});
    expect(wrapper.findAll('[data-invalid]')).toHaveLength(0);
    expect(wrapper.find('[data-block-panel="b2"]').exists()).toBe(false);
  });
});
