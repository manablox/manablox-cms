import Pager from '@manablox/admin-sdk/components/ui/Pager.vue';
import { type PageRequest, usePagedQuery } from '@manablox/admin-sdk/composables/usePagedQuery';
import { queryClient } from '@manablox/admin-sdk/lib/query-client';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';

afterEach(() => {
  queryClient.clear();
});

/** Mounts a paged query over `total` rows; `filter` resets it. */
function setup(total: { value: number }) {
  const filter = ref('a');
  const fetch = vi.fn(async ({ limit, offset }: PageRequest) => ({
    items: [],
    total: total.value,
    limit,
    offset,
  }));
  let paged!: ReturnType<typeof usePagedQuery<Awaited<ReturnType<typeof fetch>>>>;
  const wrapper = mount(
    defineComponent({
      setup() {
        paged = usePagedQuery({
          pageSize: 10,
          resetOn: [filter],
          queryKey: (page) => ['paged-test', filter.value, page],
          queryFn: fetch,
        });
        return () => h('div');
      },
    }),
  );
  return { filter, fetch, paged: () => paged, wrapper };
}

describe('usePagedQuery', () => {
  it('fetches the shown page and returns to the first on a reset', async () => {
    const { filter, fetch, paged } = setup({ value: 35 });
    await flushPromises();
    expect(paged().pages.value).toBe(4);

    paged().page.value = 2;
    await flushPromises();
    expect(fetch).toHaveBeenLastCalledWith({ limit: 10, offset: 20 });

    filter.value = 'b';
    await nextTick();
    expect(paged().page.value).toBe(0);
    await flushPromises();
    expect(fetch).toHaveBeenLastCalledWith({ limit: 10, offset: 0 });
  });

  it('steps back when the total shrinks past the page', async () => {
    const total = { value: 35 };
    const { paged } = setup(total);
    await flushPromises();
    paged().page.value = 3;
    await flushPromises();

    total.value = 30;
    await queryClient.invalidateQueries({ queryKey: ['paged-test'] });
    await flushPromises();
    expect(paged().page.value).toBe(2);
  });
});

describe('Pager', () => {
  it('shows the range and steps within bounds', async () => {
    const wrapper = mount(Pager, { props: { page: 0, total: 35, pageSize: 10 } });
    expect(wrapper.text()).toContain('1-10 of 35');
    expect(wrapper.text()).toContain('1 / 4');
    const [previous, next] = wrapper.findAll('button');
    expect(previous?.attributes('disabled')).toBeDefined();
    await next?.trigger('click');
    expect(wrapper.emitted('update:page')?.[0]).toEqual([1]);
  });

  it('hides a single page unless asked', () => {
    expect(mount(Pager, { props: { page: 0, total: 5, pageSize: 10 } }).html()).not.toContain(
      'of 5',
    );
    const always = mount(Pager, { props: { page: 0, total: 5, pageSize: 10, always: true } });
    expect(always.text()).toContain('1-5 of 5');
    expect(always.findAll('button')).toHaveLength(0);
  });
});
