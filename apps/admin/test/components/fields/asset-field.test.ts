import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

const { getMany, update } = vi.hoisted(() => ({ getMany: vi.fn(), update: vi.fn() }));
vi.mock('@manablox/admin-sdk/lib/api', () => ({ api: { assets: { getMany, update } } }));
vi.mock('@manablox/admin-sdk/stores/space', () => ({
  useSpaceStore: () => ({ currentId: 's1', spaces: [{ id: 's1', name: 'Space' }] }),
}));
vi.mock('@manablox/admin-sdk/stores/session', async () => {
  const { FEATURE_ON } = await import('@manablox/admin-sdk/lib/features');
  return { useSessionStore: () => ({ can: () => true, feature: () => FEATURE_ON }) };
});

import { provideFieldContext } from '@manablox/admin-sdk/lib/field-context';
import { queryClient } from '@manablox/admin-sdk/lib/query-client';
import AssetField from '~/components/fields/AssetField.vue';

const field = {
  id: 'f1',
  name: 'cover',
  label: 'Cover',
  type: 'asset',
  settings: {},
  required: false,
  localized: false,
  unique: false,
  admin: { zone: 'main' as const, width: 100, position: 0 },
};

const asset = {
  id: 'a1',
  name: 'cover.png',
  filename: 'cover.png',
  mimeType: 'image/png',
  size: 1024,
  width: 10,
  height: 10,
  alt: null,
  thumbnailUrl: '/thumb.png',
  url: '/asset.png',
  meta: {},
  publishAt: null,
  unpublishAt: null,
  spaceIds: ['s1'],
  tags: [],
};

/** The field with one asset held, under a stub editor context. */
function render() {
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
      });
      return () => h(AssetField, { field, modelValue: 'a1', settings: {}, path: ['cover'] });
    },
  });
  return mount(Host, { attachTo: document.body });
}

beforeEach(() => {
  queryClient.clear();
  getMany.mockReset().mockResolvedValue([asset]);
  update.mockReset().mockResolvedValue(asset);
});

describe('AssetField', () => {
  it('opens the asset details in a dialog and saves an edit', async () => {
    const wrapper = render();
    const edit = await vi.waitUntil(() =>
      wrapper
        .findAll('button')
        .find((button) => button.attributes('aria-label') === 'Edit cover.png'),
    );
    await edit.trigger('click');

    const dialog = await vi.waitUntil(() => document.querySelector('[role="dialog"]'));
    expect(dialog.textContent).toContain('cover.png');
    expect(dialog.textContent).toContain('Alt text');

    const alt = dialog.querySelectorAll('input')[1] as HTMLInputElement;
    alt.value = 'A cover';
    alt.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve));
    (dialog.querySelector('button[type="submit"]') as HTMLButtonElement).click();

    await vi.waitUntil(() => update.mock.calls.length > 0);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1', alt: 'A cover' }));
    wrapper.unmount();
  });
});
