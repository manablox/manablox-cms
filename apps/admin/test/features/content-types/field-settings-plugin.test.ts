import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';

vi.mock('@manablox/admin-sdk/stores/space', () => ({
  useSpaceStore: () => ({
    currentId: 's1',
    locale: 'en',
    templateType: null,
    blockKinds: [],
    creatableKinds: [],
    dataKinds: [],
    fieldTypeMeta: (name: string) =>
      name === 'color' ? { name, admin: { input: 'color', settings: 'color' } } : null,
  }),
}));
vi.mock('@manablox/admin-sdk/features/content/queries', () => ({
  useTemplates: () => ({ data: ref(null) }),
}));

import FieldSettings from '~/features/content-types/components/FieldSettings.vue';
import { registerFieldComponents } from '~/lib/field-components';

/** A plugin settings form that shows its props and emits new settings on click. */
const ColorSettings = defineComponent({
  props: { settings: Object, field: Object, readOnly: Boolean },
  emits: ['update:settings'],
  setup(props, { emit }) {
    return () =>
      h(
        'button',
        {
          'data-plugin-settings': '',
          'data-read-only': String(props.readOnly),
          onClick: () => emit('update:settings', { ...props.settings, allowAlpha: true }),
        },
        `presets ${(props.settings?.presets as string[]).join(',')} on ${props.field?.name}`,
      );
  },
});
// Shaped like a dynamic import's module namespace.
registerFieldComponents({
  settings: { color: async () => ({ __esModule: true, default: ColorSettings }) },
});

const field = (type: string) => ({
  id: 'f1',
  name: 'accent',
  label: 'Accent',
  type,
  settings: { presets: ['#fff'] },
  required: false,
  localized: false,
  unique: false,
  admin: { zone: 'main' as const, width: 100, position: 0 },
});

function render(type: string) {
  return mount(FieldSettings, {
    props: { modelValue: field(type), readOnly: false, index: 0, errorFor: () => null },
    global: { stubs: { FieldSettingControl: true, CheckCard: true, SegmentedControl: true } },
  });
}

describe('FieldSettings plugin settings', () => {
  it('renders the settings component a plugin registered, bound to the settings', async () => {
    const wrapper = render('color');
    const form = await vi.waitFor(() => wrapper.get('[data-plugin-settings]'), {
      timeout: 10_000,
    });
    expect(form.text()).toBe('presets #fff on accent');
    expect(form.attributes('data-read-only')).toBe('false');

    await form.trigger('click');
    const [next] = wrapper.emitted('update:modelValue')?.at(-1) as [{ settings: unknown }];
    expect(next.settings).toEqual({ presets: ['#fff'], allowAlpha: true });
  });

  it('renders nothing extra for a type without one', () => {
    const wrapper = render('string');
    expect(wrapper.text()).not.toContain('Settings');
    expect(wrapper.find('[data-plugin-settings]').exists()).toBe(false);
  });
});
