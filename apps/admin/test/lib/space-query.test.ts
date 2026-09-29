import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';

const api = vi.hoisted(() => ({
  apiHosts: { list: vi.fn(async () => []) },
  users: { revokeApiKey: vi.fn(async () => ({ ok: true })) },
}));

vi.mock('@manablox/admin-sdk/lib/api', () => ({ api }));
vi.mock('@manablox/admin-sdk/stores/space', () => {
  const store = { currentId: 'space-1' as string | null };
  return { useSpaceStore: () => store };
});

import { keys } from '@manablox/admin-sdk/lib/keys';
import { queryClient } from '@manablox/admin-sdk/lib/query-client';
import { useSpaceQuery } from '@manablox/admin-sdk/lib/space-query';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { apiKeys } from '~/features/api-keys/queries';
import { useApiHosts } from '~/features/spaces/queries';

const store = useSpaceStore() as { currentId: string | null };

/** Runs `setup` inside a mounted component. */
function within<T>(setup: () => T): T {
  let result!: T;
  mount(
    defineComponent({
      setup() {
        result = setup();
        return () => h('div');
      },
    }),
  );
  return result;
}

const invalidated = (key: readonly unknown[]) =>
  queryClient.getQueryCache().find({ queryKey: key })?.state.isInvalidated ?? null;

beforeEach(() => {
  store.currentId = 'space-1';
});

afterEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
});

describe('useSpaceQuery', () => {
  it("reads the store's current space when none is passed", async () => {
    const fn = vi.fn(async (spaceId: string) => spaceId);
    const query = within(() => useSpaceQuery((space) => ['probe', space], fn));
    await flushPromises();
    expect(fn).toHaveBeenCalledWith('space-1');
    expect(query.data.value).toBe('space-1');
  });

  it('stays idle without a space and runs once one is picked', async () => {
    const space = ref<string | null>(null);
    const fn = vi.fn(async (spaceId: string) => spaceId);
    const query = within(() => useSpaceQuery((id) => ['probe', id], fn, { spaceId: space }));
    await flushPromises();
    expect(fn).not.toHaveBeenCalled();
    expect(query.isPending.value).toBe(true);

    space.value = 'space-2';
    await flushPromises();
    expect(fn).toHaveBeenCalledWith('space-2');
  });

  it('stays idle while the store has no space', async () => {
    store.currentId = null;
    const fn = vi.fn(async (spaceId: string) => spaceId);
    within(() => useSpaceQuery((id) => ['probe', id], fn));
    await flushPromises();
    expect(fn).not.toHaveBeenCalled();
  });

  it('prefers an explicit space over the store', async () => {
    const fn = vi.fn(async (spaceId: string) => spaceId);
    within(() => useSpaceQuery((space) => ['probe', space], fn, { spaceId: () => 'space-9' }));
    await flushPromises();
    expect(fn).toHaveBeenCalledWith('space-9');
  });

  it('shows the placeholder while a new key loads', async () => {
    let resolve!: (value: string) => void;
    const query = within(() =>
      useSpaceQuery(
        (space) => ['probe', space],
        () => new Promise<string>((done) => (resolve = done)),
        { placeholderData: () => 'placeholder' },
      ),
    );
    await flushPromises();
    expect(query.data.value).toBe('placeholder');
    resolve('loaded');
    await flushPromises();
    expect(query.data.value).toBe('loaded');
  });
});

describe('useApiHosts', () => {
  it('does not fetch without a space', async () => {
    store.currentId = null;
    within(() => useApiHosts());
    await flushPromises();
    expect(api.apiHosts.list).not.toHaveBeenCalled();
  });

  it("fetches the current space's hosts", async () => {
    within(() => useApiHosts());
    await flushPromises();
    expect(api.apiHosts.list).toHaveBeenCalledWith({ spaceId: 'space-1' });
  });
});

describe('writes', () => {
  it('invalidates after a write without a space', async () => {
    queryClient.setQueryData(keys.apiKeys.all(), []);
    await apiKeys.revoke('key-1');
    expect(api.users.revokeApiKey).toHaveBeenCalledWith({ id: 'key-1' });
    expect(invalidated(keys.apiKeys.all())).toBe(true);
  });
});
