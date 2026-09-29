import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

const workflowsApi = vi.hoisted(() => ({
  catalog: vi.fn(() =>
    Promise.resolve({
      triggerKinds: [
        { kind: 'acme.ping', label: 'When Acme pings', hint: 'Acme calls in.', aborts: false },
      ],
      triggers: { 'acme.ping': { channels: ['c1'] } },
    }),
  ),
}));
vi.mock('@manablox/admin-sdk/lib/api', () => ({ api: {}, pluginClient: () => workflowsApi }));
vi.mock('@manablox/admin-sdk/stores/space', () => ({ useSpaceStore: () => ({ currentId: 's1' }) }));
vi.mock('@manablox/admin-sdk/stores/session', () => ({
  useSessionStore: () => ({ can: () => true }),
}));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { registerSlotEntry, resetPluginSlots } from '@manablox/admin-sdk/lib/plugin-slots';
import WorkflowCreateDialog from '../../src/admin/components/WorkflowCreateDialog.vue';
import { TRIGGER_KINDS } from '../../src/admin/model';

const Dialog = defineComponent({
  setup:
    (_props, { slots }) =>
    () => [slots.default?.({ close: () => {} }), slots.footer?.({ close: () => {} })],
});

/** A contributed kind's form: prints the trigger it is handed and the mode. */
const PingForm = defineComponent({
  props: { trigger: { type: Object, required: true }, mode: { type: String, required: true } },
  setup: (props) => () =>
    h('p', { 'data-ping': '' }, `${props.mode}:${JSON.stringify(props.trigger)}`),
});

/** A create action's pane. */
const DescribePane = defineComponent({
  props: { spaceId: { type: String, required: true } },
  setup: (props) => () => h('p', { 'data-describe': '' }, `describe in ${props.spaceId}`),
});

const component =
  <T>(value: T) =>
  async () => ({ default: value });

function contribute() {
  registerSlotEntry({ id: 'acme', feature: 'plugins.acme' }, 'workflows:triggerForm', {
    key: 'ping',
    kind: 'acme.ping',
    feature: null,
    create: (preset: string | null, own: unknown) => ({
      kind: 'acme.ping',
      channel: preset ?? (own as { channels: string[] } | undefined)?.channels[0] ?? null,
    }),
    component: component(PingForm),
  } as never);
}

async function open(props: Record<string, unknown> = {}) {
  const wrapper = mount(WorkflowCreateDialog, {
    props: { spaceId: 's1', ...props },
    global: { stubs: { Dialog } },
  });
  await flushPromises();
  return wrapper;
}

afterEach(() => resetPluginSlots());

describe('WorkflowCreateDialog', () => {
  it('shows the hint of the picked trigger kind', async () => {
    const wrapper = await open();
    const picker = wrapper.get('[aria-label="What starts the workflow"]');
    const builtins = Object.values(TRIGGER_KINDS);
    for (const [index, entry] of builtins.entries()) {
      await picker.findAll('button')[index]?.trigger('click');
      expect(wrapper.text()).toContain(entry.hint);
      for (const other of builtins) {
        if (other !== entry) expect(wrapper.text()).not.toContain(other.hint);
      }
    }
    wrapper.unmount();
  });

  it("offers a contributed kind and draws its form, pointed at the dialog's preset", async () => {
    contribute();
    const wrapper = await open({ kind: 'acme.ping', preset: 'c7' });
    const picker = wrapper.get('[aria-label="What starts the workflow"]');
    expect(picker.text()).toContain('When Acme pings');
    expect(wrapper.text()).toContain('Acme calls in.');
    expect(wrapper.get('[data-ping]').text()).toBe(
      `create:${JSON.stringify({ kind: 'acme.ping', channel: 'c7' })}`,
    );

    // Picking the kind again starts from its catalogue entry.
    await picker.findAll('button')[0]?.trigger('click');
    expect(wrapper.find('[data-ping]').exists()).toBe(false);
    const ping = picker.findAll('button').find((button) => button.text().includes('Acme'));
    await ping?.trigger('click');
    expect(wrapper.get('[data-ping]').text()).toContain('"channel":"c1"');
    wrapper.unmount();
  });

  it('offers the create actions other plugins add, next to building it by hand', async () => {
    const plain = await open();
    expect(plain.find('[aria-label="How to start"]').exists()).toBe(false);
    plain.unmount();

    registerSlotEntry({ id: 'acme', feature: 'plugins.acme' }, 'workflows:createActions', {
      key: 'describe',
      label: 'Describe it',
      icon: 'wand',
      feature: null,
      component: component(DescribePane),
    });
    const wrapper = await open();
    const modes = wrapper.get('[aria-label="How to start"]');
    expect(modes.text()).toContain('Build it');
    expect(modes.text()).toContain('Describe it');
    await modes.findAll('button').at(-1)?.trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-describe]').text()).toBe('describe in s1');
    expect(wrapper.find('[aria-label="What starts the workflow"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
