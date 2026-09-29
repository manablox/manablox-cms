import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { h } from 'vue';

vi.mock('@manablox/admin-sdk/stores/space', () => ({ useSpaceStore: () => ({ currentId: 's1' }) }));

import FeatureGate from '@manablox/admin-sdk/components/feature/FeatureGate.vue';
import { featureState } from '@manablox/admin-sdk/lib/features';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import type { FeatureKey } from '@manablox/core';
import FeatureLocked from '~/components/feature/FeatureLocked.vue';
import { meWithControls } from '../../controls-fixture';

beforeEach(() => {
  setActivePinia(createPinia());
  useSessionStore().me = meWithControls();
});

const gate = (feature: FeatureKey, slots: Record<string, () => unknown> = {}) =>
  mount(FeatureGate, {
    props: { feature, label: 'Generate', triggerClass: 'mb-btn-ghost' },
    slots: { default: () => h('button', { 'data-control': '' }, 'Generate'), ...slots },
    global: { stubs: { Icon: true } },
  });

describe('FeatureGate', () => {
  it('renders the control while the feature is on', () => {
    const wrapper = gate('approvals');
    expect(wrapper.find('[data-control]').exists()).toBe(true);
    expect(wrapper.find('[data-feature-lock]').exists()).toBe(false);
  });

  it('renders nothing for a hidden feature', () => {
    const wrapper = gate('menus');
    expect(wrapper.find('[data-control]').exists()).toBe(false);
    expect(wrapper.find('[data-feature-lock]').exists()).toBe(false);
  });

  it('renders a labelled lock in place of a locked control', () => {
    const wrapper = gate('databags');
    expect(wrapper.find('[data-control]').exists()).toBe(false);
    const lock = wrapper.find('[data-feature-lock]');
    expect(lock.exists()).toBe(true);
    expect(lock.classes()).toContain('mb-btn-ghost');
    expect(lock.text()).toContain('Generate');
    expect(lock.attributes('aria-label')).toBe('Generate - locked');
  });

  it('uses the locked slot when given', () => {
    const wrapper = gate('databags', { locked: () => h('span', { 'data-custom': '' }, 'custom') });
    expect(wrapper.find('[data-custom]').exists()).toBe(true);
    expect(wrapper.find('[data-feature-lock]').exists()).toBe(false);
  });
});

describe('FeatureLocked', () => {
  const panel = (feature: FeatureKey) =>
    mount(FeatureLocked, {
      props: { feature, state: featureState(meWithControls(), feature, 's1') },
      global: { stubs: { Icon: true } },
    });

  it('shows the message and the upgrade link of a locked feature', () => {
    const wrapper = panel('databags');
    expect(wrapper.text()).toContain('Databags is locked');
    expect(wrapper.text()).toContain('Upgrade for databags');
    expect(wrapper.find('a').attributes('href')).toBe('https://example.com/upgrade');
  });

  it('stays neutral for a hidden feature', () => {
    const wrapper = panel('menus');
    expect(wrapper.text()).toContain('This page is not available');
    expect(wrapper.find('a').exists()).toBe(false);
  });
});
