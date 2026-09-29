import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const SNAPSHOT = '2026-09-25T10-15-00-000Z';

const actions = vi.hoisted(() => ({
  create: vi.fn(async () => ({})),
  restore: vi.fn(async () => ({})),
  download: vi.fn(async () => new Blob()),
}));
const confirmed = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('@manablox/admin-sdk/stores/space', () => ({
  useSpaceStore: () => ({ currentId: 's1', current: { id: 's1', machineName: 'site' } }),
}));
vi.mock('~/features/backups/queries', () => ({
  useSnapshots: () => ({
    data: ref({
      supported: true,
      interval: 'daily',
      retentionDays: 7,
      items: [
        {
          id: SNAPSHOT,
          spaceId: 's1',
          machineName: 'site',
          name: 'Site',
          createdAt: '2026-09-25T10:15:00.000Z',
          trigger: 'manual',
          formatVersion: 1,
          size: 4096,
          counts: { contentTypes: 1, contents: 2, assets: 0, menus: 0, workflows: 0 },
        },
      ],
    }),
    isPending: ref(false),
    error: ref(null),
    refetch: vi.fn(),
  }),
  snapshots: actions,
}));
vi.mock('@manablox/admin-sdk/lib/write', () => ({
  runWrite: async (fn: () => Promise<unknown>) => {
    await fn();
    return true;
  },
  confirmAndRun: async (options: Record<string, unknown>, fn: () => Promise<unknown>) => {
    confirmed.push(options);
    await fn();
    return true;
  },
}));

import type { Me } from '@manablox/admin-sdk/lib/api-types';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import BackupsSettings from '~/features/backups/components/BackupsSettings.vue';
import { meWithControls } from '../../controls-fixture';

function signIn(spaceRole: string, role = 'editor') {
  const me = meWithControls() as unknown as { role: string; spaces: Record<string, string> };
  me.role = role;
  me.spaces = { s1: spaceRole };
  useSessionStore().me = me as unknown as Me;
}

const mountPage = () =>
  mount(BackupsSettings, {
    global: {
      stubs: { Icon: true, Panel: { template: '<div><slot name="actions" /><slot /></div>' } },
    },
  });

const button = (wrapper: ReturnType<typeof mountPage>, text: string) =>
  wrapper.findAll('button').find((entry) => entry.text().includes(text));

beforeEach(() => {
  setActivePinia(createPinia());
  confirmed.length = 0;
  vi.clearAllMocks();
});

describe('the Backups page', () => {
  it('lists snapshots with trigger, size and counts, and the schedule', () => {
    signIn('admin');
    const text = mountPage().text();
    expect(text).toContain('By hand');
    expect(text).toContain('2 documents, 0 assets, 1 content type');
    expect(text).toContain('A snapshot is taken every day; snapshots are kept for 7 days.');
  });

  it('takes a snapshot now', async () => {
    signIn('admin');
    const wrapper = mountPage();
    await button(wrapper, 'Create snapshot now')?.trigger('click');
    expect(actions.create).toHaveBeenCalledWith('s1');
  });

  it('offers restores to owners only and downloads to superadmins only', () => {
    signIn('admin');
    const admin = mountPage();
    expect(button(admin, 'Replace this space')).toBeUndefined();
    expect(button(admin, 'Download')).toBeUndefined();

    signIn('owner');
    const owner = mountPage();
    expect(button(owner, 'Replace this space')).toBeDefined();
    expect(button(owner, 'As new space')).toBeDefined();
    expect(button(owner, 'Download')).toBeUndefined();

    signIn('editor', 'superadmin');
    const root = mountPage();
    expect(button(root, 'Download')).toBeDefined();
    expect(button(root, 'Replace this space')).toBeDefined();
  });

  it('confirms a replace by the machine name before restoring', async () => {
    signIn('owner');
    const wrapper = mountPage();
    await button(wrapper, 'Replace this space')?.trigger('click');
    await flushPromises();
    expect(confirmed[0]).toMatchObject({ requireText: 'site', danger: true });
    expect(actions.restore).toHaveBeenCalledWith('s1', SNAPSHOT, 'replace', 'site');
  });

  it('downloads the export for a superadmin', async () => {
    signIn('editor', 'superadmin');
    const wrapper = mountPage();
    const createObjectURL = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    await button(wrapper, 'Download')?.trigger('click');
    await flushPromises();
    expect(actions.download).toHaveBeenCalledWith('s1', SNAPSHOT);
  });
});
