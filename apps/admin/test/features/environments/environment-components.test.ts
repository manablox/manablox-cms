import type { EnvironmentDiff } from '@manablox/admin-sdk/features/environments/queries';
import { FEATURE_ON, type FeatureState } from '@manablox/admin-sdk/lib/features';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, ref, toValue } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

const state = vi.hoisted(() => ({
  can: true,
  feature: null as unknown,
  list: null as unknown,
  diff: null as unknown,
  mode: null as unknown,
  switchTo: null as unknown,
}));
const actions = vi.hoisted(() => ({
  promote: null as unknown,
  remove: null as unknown,
  create: null as unknown,
}));
const confirmed = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('@manablox/admin-sdk/lib/api', () => ({ api: {} }));
vi.mock('@manablox/admin-sdk/stores/space', () => ({ useSpaceStore: () => ({ currentId: 's1' }) }));
vi.mock('@manablox/admin-sdk/lib/space', () => ({
  useCan: () => computed(() => state.can),
  requireSpace: () => 's1',
  useFeature: () => state.feature,
}));
vi.mock('@manablox/admin-sdk/features/environments/queries', () => ({
  useEnvironmentDiff: (_environment: unknown, mode: unknown) => {
    state.mode = mode;
    return state.diff;
  },
  environments: actions,
}));
vi.mock('@manablox/admin-sdk/features/environments/useEnvironment', () => ({
  useEnvironment: () => ({
    machineName: ref('production'),
    production: ref(true),
    current: ref(null),
    environments: state.list,
    feature: state.feature,
    switchTo: state.switchTo,
  }),
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

import EnvironmentPromoteDialog from '~/features/environments/components/EnvironmentPromoteDialog.vue';
import EnvironmentSwitcher from '~/features/environments/components/EnvironmentSwitcher.vue';
import EnvironmentsSettings from '~/features/environments/components/EnvironmentsSettings.vue';

const Dialog = defineComponent({
  setup(_props, { slots, expose }) {
    expose({ requestClose: () => {} });
    return () => [slots.default?.({ close: () => {} }), slots.footer?.({ close: () => {} })];
  },
});

const off = (presentation: 'hidden' | 'locked'): FeatureState => ({
  enabled: false,
  hidden: presentation === 'hidden',
  locked: presentation === 'locked',
  message: null,
  link: null,
});

const row = (machineName: string) => ({
  id: `id-${machineName}`,
  machineName,
  name: machineName === 'production' ? 'Production' : 'Staging',
  kind: machineName === 'production' ? 'production' : 'staging',
  createdFrom: machineName === 'production' ? null : 'id-production',
  createdMode: machineName === 'production' ? null : 'config',
  createdAt: new Date('2026-09-26T10:00:00Z'),
  updatedAt: new Date('2026-09-26T10:00:00Z'),
});

const listOf = (...names: string[]) => ({
  data: ref(names.map(row)),
  isPending: ref(false),
  error: ref(null),
  refetch: vi.fn(),
});

const diffOf = (extra: Partial<EnvironmentDiff> = {}) => ({
  data: ref<EnvironmentDiff>({
    environment: 'staging',
    mode: 'config',
    contentTypes: [],
    changes: [
      {
        kind: 'menus',
        added: 1,
        changed: 0,
        removed: 0,
        items: [{ status: 'added', id: 'm1', label: 'Footer' }],
        truncated: false,
      },
    ],
    breaking: false,
    confirmRequired: false,
    ...extra,
  }),
  isPending: ref(false),
  isFetching: ref(false),
  error: ref(null),
  refetch: vi.fn(),
});

beforeEach(() => {
  setActivePinia(createPinia());
  state.can = true;
  state.feature = ref(FEATURE_ON);
  state.list = listOf('production', 'staging');
  state.diff = diffOf();
  state.switchTo = vi.fn();
  actions.promote = vi.fn(async () => ({
    environment: 'staging',
    mode: 'config',
    status: 'applied',
    snapshot: null,
    groups: [],
    diff: toValue((state.diff as ReturnType<typeof diffOf>).data),
  }));
  actions.remove = vi.fn(async () => {});
  confirmed.length = 0;
});

describe('EnvironmentSwitcher', () => {
  const mountSwitcher = () =>
    mount(EnvironmentSwitcher, {
      global: {
        stubs: {
          Select: defineComponent({
            props: ['options'],
            setup: () => () => h('div', { 'data-select': '' }),
          }),
          FeatureLock: defineComponent({ setup: () => () => h('div', { 'data-lock': '' }) }),
        },
      },
    });

  it('offers the environments once a staging one exists', () => {
    const wrapper = mountSwitcher();
    expect(wrapper.find('[data-select]').exists()).toBe(true);
  });

  it('is absent while production is the only environment', () => {
    state.list = listOf('production');
    const wrapper = mountSwitcher();
    expect(wrapper.find('[data-select]').exists()).toBe(false);
    expect(wrapper.find('[data-lock]').exists()).toBe(false);
  });

  it('is absent with the feature hidden', () => {
    state.feature = ref(off('hidden'));
    expect(mountSwitcher().html()).not.toContain('data-');
  });

  it('shows a lock with the feature locked', () => {
    state.feature = ref(off('locked'));
    const wrapper = mountSwitcher();
    expect(wrapper.find('[data-lock]').exists()).toBe(true);
    expect(wrapper.find('[data-select]').exists()).toBe(false);
  });
});

describe('EnvironmentPromoteDialog', () => {
  const mountDialog = () =>
    mount(EnvironmentPromoteDialog, {
      props: { environment: row('staging') as never },
      global: { stubs: { Dialog, Icon: true } },
    });
  const submitButton = (wrapper: ReturnType<typeof mountDialog>) =>
    wrapper.findAll('button').find((button) => button.text().includes('Promote to production'));

  it('previews the changes and promotes without typing when no confirmation is due', async () => {
    const wrapper = mountDialog();
    expect(wrapper.text()).toContain('Footer');
    expect(wrapper.find('input[placeholder="staging"]').exists()).toBe(false);
    expect(submitButton(wrapper)?.attributes('disabled')).toBeUndefined();
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(actions.promote).toHaveBeenCalledWith('s1', 'staging', 'config', false);
    expect(wrapper.emitted('done')).toHaveLength(1);
  });

  it('warns about breaking changes and waits for the machine name', async () => {
    state.diff = diffOf({ breaking: true, confirmRequired: true });
    const wrapper = mountDialog();
    expect(wrapper.find('[role="alert"]').text()).toContain('values');
    expect(submitButton(wrapper)?.attributes('disabled')).toBeDefined();
    await wrapper.find('form').trigger('submit');
    expect(actions.promote).not.toHaveBeenCalled();
    await wrapper.find('input[placeholder="staging"]').setValue('staging');
    expect(submitButton(wrapper)?.attributes('disabled')).toBeUndefined();
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(actions.promote).toHaveBeenCalledWith('s1', 'staging', 'config', true);
  });

  it('compares again for the mode picked', async () => {
    const wrapper = mountDialog();
    expect(toValue(state.mode as never)).toBe('config');
    const full = wrapper.findAll('input[type="radio"]').at(1);
    await full?.setValue(true);
    expect(toValue(state.mode as never)).toBe('full');
  });
});

describe('EnvironmentsSettings', () => {
  const mountPage = async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:any(.*)*', component: { render: () => null } }],
    });
    await router.push('/settings?tab=environments');
    const wrapper = mount(EnvironmentsSettings, {
      global: {
        plugins: [router],
        stubs: {
          Icon: true,
          Panel: { template: '<div><slot name="actions" /><slot /></div>' },
          FeatureGate: { template: '<div><slot /></div>' },
          EnvironmentPromoteDialog: defineComponent({
            props: ['environment'],
            setup: (props) => () => h('div', { 'data-promote': props.environment.machineName }),
          }),
        },
      },
    });
    await flushPromises();
    return { wrapper, router };
  };
  const button = (wrapper: { findAll: (s: string) => { text: () => string }[] }, text: string) =>
    wrapper.findAll('button').find((entry) => entry.text().includes(text)) as
      | { trigger: (event: string) => Promise<void> }
      | undefined;

  it('lists production and staging with where the copy came from', async () => {
    const { wrapper } = await mountPage();
    expect(wrapper.text()).toContain('Production');
    expect(wrapper.text()).toContain('Copied from Production (config only)');
  });

  it('deletes a staging environment after typing its machine name', async () => {
    const { wrapper } = await mountPage();
    await button(wrapper, 'Delete')?.trigger('click');
    await flushPromises();
    expect(confirmed[0]).toMatchObject({ requireText: 'staging', danger: true });
    expect(actions.remove).toHaveBeenCalledWith('s1', 'staging');
  });

  it('opens the promote dialog from the row and from ?promote=', async () => {
    const { wrapper } = await mountPage();
    expect(wrapper.find('[data-promote]').exists()).toBe(false);
    await button(wrapper, 'Promote')?.trigger('click');
    expect(wrapper.find('[data-promote="staging"]').exists()).toBe(true);

    const linked = await mountPage();
    await linked.router.push('/settings?tab=environments&promote=staging');
    await flushPromises();
    expect(linked.wrapper.find('[data-promote="staging"]').exists()).toBe(true);
    expect(linked.router.currentRoute.value.query.promote).toBeUndefined();
  });

  it('shows no promote or delete without the permission', async () => {
    state.can = false;
    const { wrapper } = await mountPage();
    expect(button(wrapper, 'Promote')).toBeUndefined();
    expect(button(wrapper, 'Delete')).toBeUndefined();
    expect(button(wrapper, 'New environment')).toBeUndefined();
  });
});
