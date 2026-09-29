import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import {
  WORKFLOW_ABORT_TRIGGER_KINDS,
  WORKFLOW_NODE_KINDS,
  WORKFLOW_NODE_SPECS,
  WORKFLOW_TRIGGER_KINDS,
  WORKFLOW_TRIGGER_SPECS,
  type WorkflowAbortTrigger,
  type WorkflowNodeLog,
  type WorkflowTrigger,
} from '../../src/sdk';

vi.mock('@manablox/admin-sdk/stores/space', () => ({
  useSpaceStore: () => ({ currentId: 's1', contentTypes: [], current: { locales: [] } }),
}));

import { ICON_NAMES } from '@manablox/admin-sdk/lib/icon-names';
import { registerSlotEntry, resetPluginSlots } from '@manablox/admin-sdk/lib/plugin-slots';
import AbortTriggersCard from '../../src/admin/components/AbortTriggersCard.vue';
import { flowNodeCache } from '../../src/admin/components/canvas/flowElements';
import NodePalette from '../../src/admin/components/NodePalette.vue';
import TriggerCard from '../../src/admin/components/TriggerCard.vue';
import {
  CONTROL_NODE_LIST,
  CONTROL_NODES,
  nodeLabel,
  portsOf,
  TRIGGER_KINDS,
  triggerKind,
  useTriggerKinds,
} from '../../src/admin/model';
import { stepIcon, stepLabel } from '../../src/admin/model/runs';
import type { WorkflowCatalog } from '../../src/admin/queries';

const sorted = (names: readonly string[]) => [...names].sort();
const icons = new Set<string>(ICON_NAMES);
const at = { x: 0, y: 0 };
/** The bundle's utilities carry its `wf:` prefix. */
const MEDIUM = '[class~="wf:font-medium"]';

describe('control node registry', () => {
  it('has an entry for every core node kind but actions', () => {
    expect(sorted(Object.keys(CONTROL_NODES))).toEqual(
      sorted(WORKFLOW_NODE_KINDS.filter((kind) => kind !== 'action')),
    );
  });

  it('creates nodes of its kind with core labels, ports and known icons', () => {
    for (const entry of CONTROL_NODE_LIST) {
      const node = entry.create(at, []);
      expect(node.kind).toBe(entry.kind);
      expect(entry.label).toBe(WORKFLOW_NODE_SPECS[entry.kind].label);
      expect(entry.description).toBe(WORKFLOW_NODE_SPECS[entry.kind].description);
      expect(nodeLabel(node, [])).toBe(entry.label);
      expect(portsOf(node, [])).toEqual(WORKFLOW_NODE_SPECS[entry.kind].ports(node as never));
      expect(icons.has(entry.icon)).toBe(true);
    }
  });

  it('keeps new keys unique', () => {
    const first = CONTROL_NODES.delay.create(at, []);
    expect(CONTROL_NODES.delay.create(at, [first.key]).key).toBe(`${first.key}_2`);
  });

  it('gives the canvas and the run log the same label, icon and tone', () => {
    const entry = flowNodeCache();
    for (const control of CONTROL_NODE_LIST) {
      const node = control.create(at, []);
      const data = entry(node, {
        meta: undefined,
        error: null,
        runStatus: null,
        workflowName: undefined,
        readOnly: false,
      }).data;
      expect(data).toMatchObject({ label: control.label, icon: control.icon, tone: control.tone });
      const log = { kind: node.kind, name: '', action: null } as WorkflowNodeLog;
      expect(stepLabel(log, [])).toBe(control.label);
      expect(stepIcon(log, [])).toBe(control.icon);
    }
  });
});

describe('NodePalette', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('emits add with the kind of each control node', async () => {
    const wrapper = mount(NodePalette, { props: { catalog: undefined } });
    const buttons = wrapper.findAll('button');
    expect(buttons.map((button) => button.find(MEDIUM).text())).toEqual(
      CONTROL_NODE_LIST.map((entry) => entry.label),
    );
    for (const button of buttons) await button.trigger('click');
    expect(wrapper.emitted('add')).toEqual(CONTROL_NODE_LIST.map((entry) => [entry.kind]));
    wrapper.unmount();
  });

  it('filters control nodes by the search', async () => {
    const wrapper = mount(NodePalette, { props: { catalog: undefined } });
    await wrapper.find('input').setValue('repeat');
    expect(wrapper.findAll('button').map((button) => button.find(MEDIUM).text())).toEqual([
      CONTROL_NODES.loop.label,
    ]);
    wrapper.unmount();
  });
});

describe('trigger kind registry', () => {
  it('has an entry for every built-in trigger kind, with its label and hint', () => {
    expect(sorted(Object.keys(TRIGGER_KINDS))).toEqual(sorted(WORKFLOW_TRIGGER_KINDS));
    for (const kind of WORKFLOW_TRIGGER_KINDS) {
      const entry = TRIGGER_KINDS[kind];
      expect(entry.label).toBe(WORKFLOW_TRIGGER_SPECS[kind].label);
      expect(entry.hint).toBe(WORKFLOW_TRIGGER_SPECS[kind].hint);
      expect(entry.create(null).kind).toBe(kind);
      expect(icons.has(entry.icon)).toBe(true);
    }
  });

  it('can make an abort trigger exactly for the kinds core lets abort', () => {
    const aborting = Object.values(TRIGGER_KINDS).filter((entry) => entry.abort);
    expect(sorted(aborting.map((entry) => entry.kind))).toEqual(
      sorted(WORKFLOW_ABORT_TRIGGER_KINDS),
    );
    for (const entry of aborting) {
      const spec = WORKFLOW_TRIGGER_SPECS[entry.kind as keyof typeof WORKFLOW_TRIGGER_SPECS];
      expect(entry.abort?.(null).kind).toBe(entry.kind);
      expect(entry.abortLabel).toBe(spec.abortLabel ?? spec.label);
      expect(entry.abortHint).toBe(spec.abortHint ?? spec.hint);
    }
  });

  it('labels the trigger and abort trigger pickers from the registry', () => {
    const trigger = TRIGGER_KINDS.event.create(null) as unknown as WorkflowTrigger;
    const card = mount(TriggerCard, {
      props: { trigger, spaceId: 's1', catalog: undefined, readOnly: false, errorFor: () => null },
    });
    const kinds = card.find('[aria-label="Trigger kind"]').findAll('button');
    expect(kinds.map((button) => button.text())).toEqual(
      WORKFLOW_TRIGGER_KINDS.map((kind) => WORKFLOW_TRIGGER_SPECS[kind].label),
    );
    card.unmount();

    const triggers = [TRIGGER_KINDS.event.abort?.(null)] as WorkflowAbortTrigger[];
    const aborts = mount(AbortTriggersCard, {
      props: { triggers, spaceId: 's1', catalog: undefined, readOnly: false, errorFor: () => null },
    });
    const labels = aborts.find('[aria-label="Abort trigger kind"]').text();
    for (const kind of WORKFLOW_ABORT_TRIGGER_KINDS) {
      expect(labels).toContain(TRIGGER_KINDS[kind].abortLabel);
    }
    expect(labels).toContain('When an event happens');
    expect(labels).not.toContain(WORKFLOW_TRIGGER_SPECS.event.label);
    expect(aborts.text()).toContain(TRIGGER_KINDS.event.abortHint);
    aborts.unmount();
  });
});

describe('contributed trigger kinds', () => {
  const spec = {
    kind: 'acme.ping',
    label: 'When Acme pings',
    hint: 'Acme calls in.',
    aborts: true,
    context: ['payload'],
  };
  const catalog = {
    triggerKinds: [spec],
    triggers: { 'acme.ping': { channels: ['c1'] } },
  } as unknown as WorkflowCatalog;
  const create = vi.fn((preset: string | null, own: unknown) => ({
    kind: 'acme.ping',
    channel: preset ?? (own as { channels: string[] }).channels[0],
  }));

  beforeEach(() => {
    setActivePinia(createPinia());
    registerSlotEntry({ id: 'acme', feature: 'plugins.acme' }, 'workflows:triggerForm', {
      key: 'ping',
      kind: 'acme.ping',
      feature: null,
      icon: 'bell',
      create,
      abort: (preset: string | null) => ({ kind: 'acme.ping', channel: preset }),
      component: async () => ({ default: defineComponent({ render: () => h('div') }) }),
    } as never);
  });
  afterEach(() => resetPluginSlots());

  /** `useTriggerKinds` of `current`, inside a mounted component. */
  function kindsOf(current: WorkflowCatalog | undefined) {
    let kinds!: ReturnType<typeof useTriggerKinds>;
    mount(
      defineComponent({
        setup() {
          kinds = useTriggerKinds(() => current);
          return () => h('div');
        },
      }),
    );
    return kinds;
  }

  it('offers a kind after the built-in ones once the server knows it', () => {
    const kinds = kindsOf(catalog);
    expect(kinds.list.value.map((entry) => entry.kind)).toEqual([
      ...Object.keys(TRIGGER_KINDS),
      'acme.ping',
    ]);
    const entry = kinds.of('acme.ping');
    expect(entry).toMatchObject({ label: spec.label, hint: spec.hint, icon: 'bell' });
    expect(kinds.abortList.value.map((kind) => kind.kind)).toContain('acme.ping');
  });

  it("creates its triggers with the kind's catalogue entry and a preset", () => {
    const kinds = kindsOf(catalog);
    expect(kinds.of('acme.ping').create(null)).toEqual({ kind: 'acme.ping', channel: 'c1' });
    expect(kinds.of('acme.ping').create('c9')).toEqual({ kind: 'acme.ping', channel: 'c9' });
    expect(kinds.of('acme.ping').abort?.('c2')).toMatchObject({
      kind: 'acme.ping',
      channel: 'c2',
      filter: null,
      match: { mode: 'all' },
    });
  });

  it('does not offer a kind the server lacks, but still names one it meets', () => {
    const kinds = kindsOf(undefined);
    expect(kinds.list.value.map((entry) => entry.kind)).not.toContain('acme.ping');
    expect(triggerKind('acme.ping').entry?.kind).toBe('acme.ping');
    expect(triggerKind('gone.kind')).toMatchObject({ label: 'gone.kind', abort: null });
    expect(triggerKind('gone.kind').entry).toBeUndefined();
  });
});
