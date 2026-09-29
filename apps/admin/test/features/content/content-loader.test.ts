import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive } from 'vue';

const route = reactive({
  name: 'content-edit',
  fullPath: '/content/doc-1',
  params: { id: 'doc-1' } as Record<string, string>,
  query: {},
});
const get = vi.fn();

vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('@manablox/admin-sdk/features/content/queries', () => ({
  content: { get: (...args: unknown[]) => get(...args), blank: vi.fn() },
}));
vi.mock('@manablox/admin-sdk/stores/space', () => ({
  useSpaceStore: () => ({
    currentId: 'space-1',
    locale: 'en',
    templateType: null,
    typeById: () => ({ kind: 'document' }),
  }),
}));

import { useContentLoader } from '~/features/content/useContentLoader';

const row = {
  id: 'doc-1',
  spaceId: 'space-1',
  typeId: 'type-1',
  locale: 'en',
  parentId: null,
  title: 'Hello',
  slug: 'hello',
  fields: {},
  position: 0,
  version: 1,
  localizationId: 'loc-1',
  tags: [],
};

function render() {
  const draft = { open: vi.fn(), close: vi.fn() };
  const onLoaded = vi.fn();
  let loader!: ReturnType<typeof useContentLoader>;
  const Host = defineComponent({
    setup() {
      loader = useContentLoader({
        draft,
        section: () => '/content',
        isNew: () => false,
        onBlank: vi.fn(),
        onLoaded,
      });
      return () => null;
    },
  });
  mount(Host);
  return { loader, draft, onLoaded };
}

describe('useContentLoader', () => {
  it('stops loading and exposes the error when the fetch fails, then retries', async () => {
    const failure = new Error('network down');
    get.mockRejectedValueOnce(failure).mockResolvedValueOnce(row);
    const { loader, draft, onLoaded } = render();
    await flushPromises();

    expect(loader.loading.value).toBe(false);
    expect(loader.error.value).toBe(failure);
    expect(draft.open).not.toHaveBeenCalled();

    const retrying = loader.retry();
    expect(loader.loading.value).toBe(true);
    expect(loader.error.value).toBeNull();
    await retrying;

    expect(loader.loading.value).toBe(false);
    expect(loader.error.value).toBeNull();
    expect(onLoaded).toHaveBeenCalledWith(row);
    expect(draft.open).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc-1' }));
    expect(loader.localizationId.value).toBe('loc-1');
  });
});
