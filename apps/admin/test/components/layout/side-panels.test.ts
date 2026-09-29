import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteLocationNormalizedLoaded } from 'vue-router';

const current = vi.hoisted(() => ({ route: null as RouteLocationNormalizedLoaded | null }));
const spaceStore = vi.hoisted(() => ({
  spaces: [{ id: 'space-1', name: 'Site', locales: ['en'], url: null }],
  current: null,
}));

vi.mock('vue-router', async (original) => ({
  ...(await original<typeof import('vue-router')>()),
  useRoute: () => current.route,
}));
vi.mock('@manablox/admin-sdk/stores/space', () => ({ useSpaceStore: () => spaceStore }));

import { useUiStore } from '@manablox/admin-sdk/stores/ui';
import { SIDE_PANELS, sidePanelFor } from '~/components/layout/side-panels';
import Topbar from '~/components/Topbar.vue';
import { router } from '~/router';

const resolve = (path: string) => router.resolve(path) as unknown as RouteLocationNormalizedLoaded;

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('side panels', () => {
  it('registers every panel a route names', () => {
    const named = router.getRoutes().filter((route) => route.meta.panel);
    expect(named.length).toBeGreaterThan(0);
    for (const route of named) {
      const panel = route.meta.panel;
      expect(panel && SIDE_PANELS[panel as keyof typeof SIDE_PANELS]?.key, route.path).toBe(panel);
    }
  });

  it('gives /settings the Settings panel', () => {
    expect(sidePanelFor(resolve('/settings'))).toBe(SIDE_PANELS.settings);
  });

  it('opens the Settings drawer from the top bar on /settings', async () => {
    current.route = resolve('/settings');
    const wrapper = mount(Topbar, {
      global: {
        plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]],
        stubs: {
          Icon: true,
          NotificationBell: true,
          SegmentedControl: true,
          RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
        },
      },
    });

    const toggle = wrapper.get('button[aria-label="Open settings"]');
    expect(toggle.text()).toBe('Settings');
    await toggle.trigger('click');
    expect(useUiStore().panelOpen).toBe(true);
  });
});
