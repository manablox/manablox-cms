import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

const workflowsApi = vi.hoisted(() => ({
  setEnabled: vi.fn(),
  import: vi.fn(async () => ({ id: 'w1' })),
  catalog: vi.fn(async () => ({ events: [] })),
}));
vi.mock('@manablox/admin-sdk/lib/api', () => ({ api: {}, pluginClient: () => workflowsApi }));
vi.mock('@manablox/admin-sdk/stores/space', () => {
  const store = { currentId: 'space-1' as string | null };
  return { useSpaceStore: () => store };
});

import { registerSlotEntry, resetPluginSlots } from '@manablox/admin-sdk/lib/plugin-slots';
import { queryClient } from '@manablox/admin-sdk/lib/query-client';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { invalidateCatalog, invalidateWorkflows, workflowKeys } from '../../src/admin/keys';
import { useWorkflowCatalog, workflows } from '../../src/admin/queries';

const store = useSpaceStore() as { currentId: string | null };

const invalidated = (key: readonly unknown[]) =>
  queryClient.getQueryCache().find({ queryKey: key })?.state.isInvalidated ?? null;

/** Runs `setup` inside a mounted component. */
function within(setup: () => unknown): void {
  mount(
    defineComponent({
      setup() {
        setup();
        return () => h('div');
      },
    }),
  );
}

beforeEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
  store.currentId = 'space-1';
});

describe('workflow keys', () => {
  const S = 'space-1';
  const samples = [
    workflowKeys.list(S),
    workflowKeys.page(S, { page: 0, limit: 25 }),
    workflowKeys.detail(S, 'w'),
    workflowKeys.runHistory(S, 'w', { test: true, page: 1 }),
    workflowKeys.run(S, 'r'),
    workflowKeys.versions(S, 'w'),
    workflowKeys.versionPage(S, 'w', 0),
    workflowKeys.version(S, 'w', 2),
    workflowKeys.catalog(S),
  ];

  it("marks every key of the space stale and leaves another space's", () => {
    for (const key of samples) queryClient.setQueryData(key, {});
    queryClient.setQueryData(workflowKeys.list('space-2'), {});
    invalidateWorkflows(S);
    for (const key of samples) expect([key, invalidated(key)]).toEqual([key, true]);
    expect(invalidated(workflowKeys.list('space-2'))).toBe(false);
  });

  it('marks only the catalogue stale for a credential or endpoint change', () => {
    for (const key of samples) queryClient.setQueryData(key, {});
    invalidateCatalog(S);
    expect(invalidated(workflowKeys.catalog(S))).toBe(true);
    expect(invalidated(workflowKeys.list(S))).toBe(false);
  });
});

describe('workflows.setEnabled', () => {
  const list = workflowKeys.list('space-1');
  const detail = workflowKeys.detail('space-1', 'w1');

  beforeEach(() => {
    queryClient.setQueryData(list, [
      { id: 'w1', enabled: false },
      { id: 'w2', enabled: false },
    ]);
    queryClient.setQueryData(detail, { id: 'w1', enabled: false });
  });

  it('flips the switch in the list and detail before the server answers', async () => {
    let answer: (value: unknown) => void = () => {};
    workflowsApi.setEnabled.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const write = workflows.setEnabled('space-1', 'w1', true);
    await vi.waitFor(() => expect(workflowsApi.setEnabled).toHaveBeenCalled());
    expect(queryClient.getQueryData(list)).toEqual([
      { id: 'w1', enabled: true },
      { id: 'w2', enabled: false },
    ]);
    expect(queryClient.getQueryData(detail)).toEqual({ id: 'w1', enabled: true });
    answer({ id: 'w1', enabled: true, name: 'One' });
    await write;
  });

  it('flips it back when the write fails', async () => {
    workflowsApi.setEnabled.mockRejectedValue(new Error('denied'));
    await expect(workflows.setEnabled('space-1', 'w1', true)).rejects.toThrow('denied');
    expect(queryClient.getQueryData(detail)).toEqual({ id: 'w1', enabled: false });
    expect(queryClient.getQueryData<{ enabled: boolean }[]>(list)?.[0]?.enabled).toBe(false);
  });
});

describe('useWorkflowCatalog', () => {
  it('does not fetch without a space', async () => {
    store.currentId = null;
    within(() => useWorkflowCatalog());
    await flushPromises();
    expect(workflowsApi.catalog).not.toHaveBeenCalled();
  });

  it("fetches the current space's catalogue", async () => {
    within(() => useWorkflowCatalog());
    await flushPromises();
    expect(workflowsApi.catalog).toHaveBeenCalledWith({ spaceId: 'space-1' });
  });
});

describe('workflows.import', () => {
  it('lets each trigger kind drop what its catalogue lists, as an import may have created it', async () => {
    const imported = vi.fn();
    const owner = { id: 'acme', feature: 'plugins.acme' };
    const component = async () => ({ default: defineComponent({ render: () => null }) });
    registerSlotEntry(owner, 'workflows:triggerForm', {
      component,
      kind: 'ping',
      imported,
    } as never);
    registerSlotEntry(owner, 'workflows:triggerForm', {
      key: 'bare',
      component,
      kind: 'pong',
    } as never);
    await workflows.import('space-1', {} as never);
    expect(imported).toHaveBeenCalledWith('space-1');
    resetPluginSlots();
  });
});
