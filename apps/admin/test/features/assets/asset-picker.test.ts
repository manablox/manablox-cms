import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

const { list } = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@manablox/admin-sdk/lib/api', () => ({ api: { assets: { list } } }));
vi.mock('@manablox/admin-sdk/stores/space', () => ({
  useSpaceStore: () => ({ currentId: 'space-1' }),
}));
vi.mock('@manablox/admin-sdk/stores/session', () => ({
  useSessionStore: () => ({ can: () => true }),
}));

import AssetPicker from '@manablox/admin-sdk/features/assets/components/AssetPicker.vue';
import { queryClient } from '@manablox/admin-sdk/lib/query-client';

const asset = (id: string) => ({
  id,
  name: `${id}.png`,
  filename: `${id}.png`,
  mimeType: 'image/png',
  size: 1024,
  width: 10,
  height: 10,
  alt: null,
  thumbnailUrl: null,
  url: null,
  spaceIds: ['space-1'],
  tags: [],
});

/** The library in two pages, so the picker has to fetch past the first. */
const PAGES = [
  { items: [asset('a'), asset('b')], total: 3, limit: 2, offset: 0 },
  { items: [asset('c')], total: 3, limit: 2, offset: 2 },
];

const Dialog = defineComponent({
  setup:
    (_props, { slots }) =>
    () => [slots.default?.({ close: () => {} }), slots.footer?.({ close: () => {} })],
});

async function picker(props: Record<string, unknown> = {}) {
  const wrapper = mount(AssetPicker, { props, global: { stubs: { Dialog } } });
  await vi.waitUntil(() => wrapper.findAll('[data-id]').length > 0);
  return wrapper;
}

const tile = (wrapper: Awaited<ReturnType<typeof picker>>, id: string) =>
  wrapper.get(`[data-id="${id}"]`);

const file = (name: string, type = 'image/png') => new File(['x'], name, { type });

/** Collects what reached the multipart upload route. */
function uploadEndpoint() {
  const names: string[] = [];
  vi.stubGlobal('fetch', (_url: string, init: { body: FormData }) => {
    const sent = init.body.get('file') as File;
    names.push(sent.name);
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: `id-${sent.name}` }) });
  });
  return () => names;
}

async function upload(wrapper: Awaited<ReturnType<typeof picker>>, files: File[]) {
  const input = wrapper.get('input[type="file"]');
  Object.defineProperty(input.element, 'files', { value: files, configurable: true });
  await input.trigger('change');
  await vi.waitUntil(() => !wrapper.text().includes('Uploading'));
}

beforeEach(() => {
  vi.unstubAllGlobals();
  queryClient.clear();
  list.mockReset();
  list.mockImplementation(({ pagination }: { pagination: { offset: number } }) =>
    Promise.resolve(PAGES.find((page) => page.offset === pagination.offset) ?? PAGES[0]),
  );
});

describe('AssetPicker', () => {
  it('uses the clicked asset at once when the field takes one', async () => {
    const wrapper = await picker();
    await tile(wrapper, 'b').trigger('click');
    expect(wrapper.emitted('select')).toEqual([[['b']]]);
  });

  it('collects several with plain and ctrl clicks and confirms them together', async () => {
    const wrapper = await picker({ multiple: true });
    await tile(wrapper, 'a').trigger('click');
    await tile(wrapper, 'b').trigger('click', { ctrlKey: true });
    expect(wrapper.emitted('select')).toBeUndefined();

    const confirm = wrapper.findAll('button').find((button) => button.text().startsWith('Add '));
    expect(confirm?.text()).toBe('Add 2 assets');
    await confirm?.trigger('click');
    expect(wrapper.emitted('select')).toEqual([[['a', 'b']]]);
  });

  it('takes a range with a shift click', async () => {
    const wrapper = await picker({ multiple: true });
    await tile(wrapper, 'a').trigger('click');
    await tile(wrapper, 'b').trigger('click', { shiftKey: true });
    expect(
      wrapper.findAll('[data-id][aria-pressed="true"]').map((node) => node.attributes('data-id')),
    ).toEqual(['a', 'b']);
  });

  it('loads the next page so the whole library is pickable', async () => {
    const wrapper = await picker({ multiple: true });
    expect(list).toHaveBeenCalledTimes(1);

    wrapper.getComponent({ name: 'ScrollSentinel' }).vm.$emit('reach');
    await vi.waitUntil(() => wrapper.findAll('[data-id]').length === 3);
    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({ pagination: expect.objectContaining({ offset: 2 }) }),
    );
  });

  it('takes several files at once even when the field holds one, and picks none of them', async () => {
    const uploads = uploadEndpoint();
    const wrapper = await picker();
    await upload(wrapper, [file('one.png'), file('two.png')]);

    expect(uploads()).toEqual(['one.png', 'two.png']);
    expect(wrapper.emitted('select')).toBeUndefined();
  });

  it('uses a lone upload right away', async () => {
    uploadEndpoint();
    const wrapper = await picker();
    await upload(wrapper, [file('one.png')]);
    expect(wrapper.emitted('select')).toEqual([[['id-one.png']]]);
  });

  it('leaves a batch unselected in a multiple field but selects a lone upload', async () => {
    uploadEndpoint();
    const wrapper = await picker({ multiple: true });
    await upload(wrapper, [file('one.png'), file('two.png')]);
    expect(wrapper.findAll('[data-id][aria-pressed="true"]')).toHaveLength(0);

    await upload(wrapper, [file('three.png')]);
    const confirm = wrapper.findAll('button').find((button) => button.text().startsWith('Add '));
    expect(confirm?.text()).toBe('Add 1 asset');
  });

  it('offers only the accepted types and refuses the rest before sending them', async () => {
    const uploads = uploadEndpoint();
    const wrapper = await picker({ accept: ['image/', 'application/pdf'] });
    expect(wrapper.get('input[type="file"]').attributes('accept')).toBe('image/*,application/pdf');

    await upload(wrapper, [file('sheet.csv', 'text/csv'), file('one.png')]);
    expect(uploads()).toEqual(['one.png']);
  });

  it('marks the assets the field already holds', async () => {
    const wrapper = await picker({ multiple: true, used: ['b'] });
    expect(tile(wrapper, 'b').text()).toContain('In field');
    expect(tile(wrapper, 'a').text()).not.toContain('In field');
  });
});
