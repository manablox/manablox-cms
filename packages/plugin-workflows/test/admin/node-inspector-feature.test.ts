import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import type { WorkflowActionNode } from '../../src/sdk';

// The generic action form loads the content types; every core read answers empty.
const empty = vi.hoisted(
  () => new Proxy({}, { get: () => new Proxy({}, { get: () => async () => [] }) }),
);
vi.mock('@manablox/admin-sdk/lib/api', async (original) => ({
  ...(await original<object>()),
  api: empty,
}));
vi.mock('@manablox/admin-sdk/stores/space', () => ({
  useSpaceStore: () => ({ currentId: 's1', contentTypes: [], current: { locales: [] } }),
}));

import type { Me } from '@manablox/admin-sdk/lib/api-types';
import { registerSlotEntry, resetPluginSlots } from '@manablox/admin-sdk/lib/plugin-slots';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import NodeInspector from '../../src/admin/components/NodeInspector.vue';
import { type Draft, newEventTrigger } from '../../src/admin/model';

/** An editor of `s1` whose controls lock the HTTP nodes and a plugin's action. */
const me = (): Me =>
  ({
    id: 'u1',
    email: 'a@example.com',
    name: 'A',
    image: null,
    role: 'editor',
    spaces: { s1: 'owner' },
    permissions: { s1: [] },
    controls: {
      features: {},
      links: {},
      banners: [],
      state: { status: 'active', message: null },
      apiKeysDisable: false,
      spaces: {
        s1: {
          features: {
            'plugins.workflows.http': { presentation: 'locked' },
            'plugins.acme.fancy': { presentation: 'locked' },
          },
        },
      },
    },
  }) as unknown as Me;

beforeEach(() => {
  setActivePinia(createPinia());
  useSessionStore().me = me();
});

const action = (type: string, enabled: boolean): WorkflowActionNode => ({
  id: 'n1',
  key: 'n1',
  name: '',
  kind: 'action',
  action: type,
  config: {},
  credentialId: null,
  enabled,
  continueOnError: false,
  join: 'any',
  ui: { x: 0, y: 0 },
});

const inspect = (node: WorkflowActionNode, catalog?: unknown) => {
  const draft: Draft = {
    name: 'Flow',
    description: '',
    enabled: false,
    trigger: newEventTrigger(),
    abortTriggers: [],
    nodes: [node],
    edges: [],
  };
  return mount(NodeInspector, {
    props: {
      draft,
      selectedId: node.id,
      spaceId: 's1',
      catalog: catalog as never,
      readOnly: false,
      errorFor: () => null,
    },
    global: { stubs: { Icon: true } },
  });
};

describe('NodeInspector action features', () => {
  it('locks switching on a node whose action feature is off', () => {
    const wrapper = inspect(action('http', false));
    expect(wrapper.find('[data-feature-lock]').exists()).toBe(true);
    expect(wrapper.find('[role="switch"][disabled]').exists()).toBe(true);
  });

  it('lets a running node of an off feature be switched off', () => {
    const wrapper = inspect(action('http', true));
    expect(wrapper.find('[data-feature-lock]').exists()).toBe(false);
    expect(wrapper.text()).toContain('This action is switched off here');
  });

  it("locks a plugin action by its catalogue entry's feature", () => {
    const meta = { type: 'acme.fancy', label: 'Fancy', feature: 'plugins.acme.fancy', fields: [] };
    const wrapper = inspect(action('acme.fancy', false), { actions: [meta] });
    expect(wrapper.find('[data-feature-lock]').exists()).toBe(true);
  });

  it('leaves nodes of actions that are on alone', () => {
    const wrapper = inspect(action('email', false));
    expect(wrapper.find('[data-feature-lock]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('This action is switched off here');
  });
});

describe('NodeInspector plugin forms', () => {
  /** An action's own form: shows its config and sets `to`. */
  const FancyForm = defineComponent({
    props: {
      config: { type: Object, required: true },
      update: { type: Function, required: true },
    },
    setup: (props) => () =>
      h('button', { 'data-fancy': '', onClick: () => props.update({ to: 'b' }) }, props.config.to),
  });

  beforeEach(() => {
    registerSlotEntry({ id: 'acme', feature: 'plugins.acme' }, 'workflows:nodeForm', {
      key: 'fancy',
      action: 'acme.fancy',
      feature: null,
      component: async () => ({ default: FancyForm }),
    } as never);
  });
  afterEach(() => resetPluginSlots());

  const field = { name: 'to', label: 'Recipient', kind: 'text' };
  const meta = { type: 'acme.fancy', label: 'Fancy', description: '', fields: [field] };
  const plain = { ...meta, type: 'acme.plain', label: 'Plain' };

  it("draws the action's own form in place of its fields, and takes its config", async () => {
    const node = { ...action('acme.fancy', true), config: { to: 'a' } };
    const wrapper = inspect(node, { actions: [meta] });
    await flushPromises();
    expect(wrapper.text()).not.toContain('Recipient');
    const form = wrapper.get('[data-fancy]');
    expect(form.text()).toBe('a');
    await form.trigger('click');
    expect(wrapper.emitted('update:node')?.at(-1)).toEqual([{ ...node, config: { to: 'b' } }]);
  });

  it('draws the fields of other actions', async () => {
    const wrapper = inspect(action('acme.plain', true), { actions: [meta, plain] });
    await flushPromises();
    expect(wrapper.find('[data-fancy]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Recipient');
  });
});
