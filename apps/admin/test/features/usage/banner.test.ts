import { mount, RouterLinkStub } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@manablox/admin-sdk/stores/space', () => ({
  useSpaceStore: () => ({ currentId: 's1', spaces: [{ id: 's1', name: 'Blog' }] }),
}));

import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import UsageBanner from '~/features/usage/components/UsageBanner.vue';
import { meWithControls } from '../../controls-fixture';

beforeEach(() => {
  setActivePinia(createPinia());
});

const withUsage = (flags: Record<string, unknown>) => {
  const me = meWithControls() as unknown as {
    controls: { usage: unknown; spaces: Record<string, Record<string, unknown>> };
  };
  me.controls.usage = {};
  me.controls.spaces.s1 = { ...me.controls.spaces.s1, usage: flags };
  useSessionStore().me = me as never;
};

const banner = () =>
  mount(UsageBanner, { global: { stubs: { Icon: true, RouterLink: RouterLinkStub } } });

describe('UsageBanner', () => {
  it('names the blocked metric, the space and the reset, with usage and upgrade links', () => {
    withUsage({
      bandwidthBytes: { level: 'blocked', resetsAt: '2026-10-01T00:00:00.000Z', scope: 'space' },
    });
    const wrapper = banner();
    expect(wrapper.attributes('role')).toBe('alert');
    expect(wrapper.text()).toContain('Bandwidth used up in Blog');
    expect(wrapper.findComponent(RouterLinkStub).props('to')).toBe('/settings?tab=usage');
    expect(wrapper.find('a[href="https://example.com/upgrade"]').exists()).toBe(true);
  });

  it('stays hidden for warnings and overages', () => {
    withUsage({
      mails: { level: 'warn', resetsAt: '2026-10-01T00:00:00.000Z', scope: 'space' },
      workflowRuns: { level: 'over', resetsAt: '2026-10-01T00:00:00.000Z', scope: 'space' },
    });
    expect(banner().html()).not.toContain('role="alert"');
  });
});
