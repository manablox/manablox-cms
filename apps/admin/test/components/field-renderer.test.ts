import { type FieldContext, provideFieldContext } from '@manablox/admin-sdk/lib/field-context';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import FieldRenderer from '~/components/FieldRenderer.vue';
import { registerSlot, resetPluginRegistry } from '~/lib/plugins/registry';
import { meWithControls } from '../controls-fixture';

vi.mock('@manablox/admin-sdk/lib/api', () => ({ api: {} }));

const field = {
  id: 'f1',
  name: 'summary',
  label: 'Summary',
  type: 'string',
  settings: {},
  required: true,
  localized: false,
  unique: false,
  admin: { zone: 'main' as const, width: 50, position: 0 },
};

/** The renderer under a stub editor context. */
function render(context: Partial<FieldContext>, props: Record<string, unknown> = {}) {
  const Host = defineComponent({
    setup() {
      provideFieldContext({
        spaceId: 's1',
        locale: 'en',
        errorFor: () => null,
        errorUnder: () => false,
        readOnly: false,
        typeById: () => null,
        typeByName: () => null,
        blockTypes: () => [],
        fieldTypeMeta: () => null,
        ...context,
      });
      return () => h(FieldRenderer, { field, modelValue: 'x', path: ['summary'], ...props });
    },
  });
  return mount(Host, { global: { stubs: { Icon: true } } });
}

describe('FieldRenderer', () => {
  it('shows the error the context reports at its path, and spans by admin.width', async () => {
    const wrapper = render({
      errorFor: (path) => (path.join('.') === 'summary' ? 'A summary is required.' : null),
    });
    expect(wrapper.text()).toContain('A summary is required.');
    expect(wrapper.text()).toContain('Summary');
    expect(wrapper.get('.col-span-4').classes()).toContain('sm:col-span-2');
    // The input is an async component; the file must not end while it is loading.
    await vi.waitFor(() => wrapper.get('input#field-f1'), { timeout: 10_000 });
  });

  it('marks the field the save was refused over', () => {
    const wrapper = render({ errorFor: () => 'A summary is required.' });
    const field = wrapper.get('.col-span-4');
    expect(field.classes()).toContain('mb-invalid');
    expect(field.attributes('data-invalid')).toBe('');
    expect(render({}).get('.col-span-4').attributes('data-invalid')).toBeUndefined();
  });

  it('says so when no input is registered for the field type', () => {
    const wrapper = render({
      fieldTypeMeta: () => ({ admin: { input: 'nothing-like-this' } }) as never,
    });
    expect(wrapper.text()).toContain('No editor registered');
  });

  it("renders the plugins' field actions beside the label, which may set the value", async () => {
    setActivePinia(createPinia());
    useSessionStore().me = meWithControls();
    registerSlot({ id: 'hello', feature: 'plugins.hello' }, 'field.actions', {
      feature: null,
      when: ({ field }) => field.type === 'string',
      component: async () => ({
        default: defineComponent({
          props: ['field', 'value', 'update', 'context'],
          setup: (props) => () =>
            h(
              'button',
              { onClick: () => (props.update as (value: unknown) => void)('from plugin') },
              `${(props.field as { label: string }).label} in ${(props.context as { locale: string }).locale}: ${props.value}`,
            ),
        }),
      }),
    });
    const updates: unknown[] = [];
    const wrapper = render({}, { 'onUpdate:modelValue': (value: unknown) => updates.push(value) });
    await flushPromises();
    await vi.waitFor(() => expect(wrapper.find('button').exists()).toBe(true));
    expect(wrapper.find('button').text()).toBe('Summary in en: x');
    await wrapper.find('button').trigger('click');
    expect(updates).toEqual(['from plugin']);
    resetPluginRegistry();
  });
});
