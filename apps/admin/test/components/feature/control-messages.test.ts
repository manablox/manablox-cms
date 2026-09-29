import { VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Dismissals the server keeps, per account. */
const server = vi.hoisted(() => ({ user: 'u1', stored: {} as Record<string, string[]> }));

vi.mock('@manablox/admin-sdk/stores/space', () => ({ useSpaceStore: () => ({ currentId: 's1' }) }));
vi.mock('@manablox/admin-sdk/lib/api', () => ({
  api: {
    preferences: {
      get: vi.fn(async () => ({ value: server.stored[server.user] ?? null })),
      set: vi.fn(async ({ value }: { value: string[] }) => {
        server.stored[server.user] = value;
      }),
    },
  },
}));

import { api } from '@manablox/admin-sdk/lib/api';
import type { Me } from '@manablox/admin-sdk/lib/api-types';
import { adminLinks, readOnlyNotice, suspension } from '@manablox/admin-sdk/lib/control-messages';
import { queryClient } from '@manablox/admin-sdk/lib/query-client';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import AdminLinksMenu from '~/components/feature/AdminLinksMenu.vue';
import ControlBanners from '~/components/feature/ControlBanners.vue';
import SuspendedPanel from '~/components/feature/SuspendedPanel.vue';
import { meWithControls } from '../../controls-fixture';

type Controls = Record<string, any>;

/** The fixture with `patch` over its controls and `space` over those of s1. */
function me(patch: Controls = {}, space: Controls = {}, role = 'editor'): Me {
  const base = meWithControls() as unknown as { role: string; controls: Controls };
  base.role = role;
  base.controls = {
    ...base.controls,
    ...patch,
    spaces: { s1: { ...base.controls.spaces.s1, ...space } },
  };
  return base as unknown as Me;
}

const banner = (id: string, level: string, extra: Controls = {}) => ({
  id,
  level,
  text: `${id} text`,
  dismissible: false,
  audience: 'all',
  ...extra,
});

beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
  queryClient.clear();
  server.user = 'u1';
  server.stored = {};
});

const mountBanners = () =>
  mount(ControlBanners, {
    global: { stubs: { Icon: true }, plugins: [[VueQueryPlugin, { queryClient }]] },
  });

describe('ControlBanners', () => {
  it('renders instance and space banners by severity, with their link', () => {
    useSessionStore().me = me(
      { banners: [banner('news', 'info', { link: 'https://example.com/news' })] },
      { banners: [banner('pay', 'danger')] },
    );
    const wrapper = mountBanners();
    const rows = wrapper.findAll('[role]');
    expect(rows.map((row) => row.text())).toEqual([
      expect.stringContaining('pay text'),
      expect.stringContaining('news text'),
    ]);
    expect(rows[0]?.attributes('role')).toBe('alert');
    expect(rows[0]?.classes()).toContain('bg-danger-50');
    expect(rows[1]?.classes()).toContain('bg-iris-50');
    expect(wrapper.find('a[href="https://example.com/news"]').exists()).toBe(true);
    expect(wrapper.find('button[aria-label="Dismiss"]').exists()).toBe(false);
  });

  it('keeps a dismissed banner hidden for that user, on the server', async () => {
    useSessionStore().me = me({ banners: [banner('tip', 'warning', { dismissible: true })] });
    const wrapper = mountBanners();
    await flushPromises();
    await wrapper.find('button[aria-label="Dismiss"]').trigger('click');
    expect(wrapper.text()).not.toContain('tip text');
    expect(api.preferences.set).toHaveBeenCalledWith({ key: 'banners.dismissed', value: ['tip'] });

    queryClient.clear();
    const again = mountBanners();
    await flushPromises();
    expect(again.text()).not.toContain('tip text');

    const other = me({ banners: [banner('tip', 'warning', { dismissible: true })] }) as Me & {
      id: string;
    };
    other.id = 'u2';
    server.user = 'u2';
    useSessionStore().me = other;
    const theirs = mountBanners();
    await flushPromises();
    expect(theirs.text()).toContain('tip text');
  });

  it('shows a read-only notice for the instance or the space', () => {
    useSessionStore().me = me({ state: { status: 'readOnly', message: 'Invoice due' } });
    const instance = mountBanners().text();
    expect(instance).toContain('This instance is read-only.');
    expect(instance).toContain('Invoice due');

    useSessionStore().me = me({}, { state: { status: 'readOnly', message: null } });
    expect(mountBanners().text()).toContain('This space is read-only.');
  });

  it('renders nothing without banners or state', () => {
    useSessionStore().me = me();
    expect(mountBanners().find('[data-testid="control-banners"]').exists()).toBe(false);
  });
});

describe('control messages', () => {
  const links = {
    docs: 'https://example.com/docs',
    billing: 'https://example.com/billing',
    upgrade: 'https://example.com/up',
  };

  it('lists billing for superadmins only', () => {
    expect(adminLinks(me({ links })).map((link) => link.key)).toEqual(['docs', 'upgrade']);
    expect(adminLinks(me({ links }, {}, 'superadmin')).map((link) => link.key)).toEqual([
      'docs',
      'billing',
      'upgrade',
    ]);
    expect(adminLinks(me({ links: {} }))).toEqual([]);
  });

  it('reads the state', () => {
    expect(readOnlyNotice(me(), 's1')).toBeNull();
    expect(suspension(me())).toBeNull();
    expect(suspension(me({ state: { status: 'suspended', message: null } }))).toBe('');
  });

  it('puts the links in a help menu, none without links', () => {
    useSessionStore().me = me({ links: {} });
    const stubs = {
      Icon: true,
      DropdownMenu: { template: '<div><slot name="trigger" /><slot /></div>' },
    };
    expect(mount(AdminLinksMenu, { global: { stubs } }).html()).not.toContain('Help');
    useSessionStore().me = me({ links });
    const menu = mount(AdminLinksMenu, { global: { stubs } });
    expect(menu.findAll('a').map((link) => link.attributes('href'))).toEqual([
      links.docs,
      links.upgrade,
    ]);
  });
});

describe('SuspendedPanel', () => {
  it('shows only the message, the links and a way out', () => {
    useSessionStore().me = me({
      state: { status: 'suspended', message: 'Paused for billing' },
      links: { support: 'https://example.com/support' },
    });
    const wrapper = mount(SuspendedPanel, { global: { stubs: { Icon: true, Logo: true } } });
    expect(wrapper.text()).toContain('This instance is suspended');
    expect(wrapper.text()).toContain('Paused for billing');
    expect(wrapper.find('a[href="https://example.com/support"]').exists()).toBe(true);
    expect(wrapper.findAll('button').map((button) => button.text())).toEqual([
      'Check again',
      'Sign out',
    ]);
  });
});
