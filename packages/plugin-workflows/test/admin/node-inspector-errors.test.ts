import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import type { WorkflowDelayNode } from '../../src/sdk';

vi.mock('@manablox/admin-sdk/stores/space', () => ({
  useSpaceStore: () => ({ currentId: 's1', contentTypes: [], current: { locales: [] } }),
}));

import type { ErrorFor } from '@manablox/admin-sdk/composables/useDraftForm';
import NodeInspector from '../../src/admin/components/NodeInspector.vue';
import { type Draft, newEventTrigger } from '../../src/admin/model';

/** Stands in for the guard form and prints what its `errorFor` answers for the rules. */
const EdgeGuardForm = defineComponent({
  props: { errorFor: { type: Function, required: true } },
  setup(props) {
    return () => h('p', { 'data-guard-error': '' }, String(props.errorFor(['rules', 0, 'value'])));
  },
});

const delay = (id: string): WorkflowDelayNode => ({
  id,
  key: id,
  name: '',
  kind: 'delay',
  minutes: 1,
  enabled: true,
  continueOnError: false,
  join: 'any',
  ui: { x: 0, y: 0 },
});

const draft = (): Draft => ({
  name: 'Flow',
  description: '',
  enabled: false,
  trigger: newEventTrigger(),
  abortTriggers: [],
  nodes: [delay('a'), delay('b')],
  edges: [
    { id: 'e0', from: 'a', fromPort: 'ok', to: 'b', guard: null },
    { id: 'e1', from: 'b', fromPort: 'ok', to: 'a', guard: null },
  ],
});

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('NodeInspector edge guard errors', () => {
  it("scopes the guard form's errors to the selected edge", () => {
    const seen: (string | number)[][] = [];
    const errorFor: ErrorFor = (path) => {
      seen.push([...path]);
      return path.join('.') === 'edges.1.guard.rules.0.value' ? 'Required' : null;
    };
    const wrapper = mount(NodeInspector, {
      props: {
        draft: draft(),
        selectedId: 'e1',
        spaceId: 's1',
        catalog: undefined,
        readOnly: false,
        errorFor,
      },
      global: { stubs: { EdgeGuardForm } },
    });
    expect(wrapper.get('[data-guard-error]').text()).toBe('Required');
    expect(seen).toContainEqual(['edges', 1, 'guard', 'rules', 0, 'value']);
  });
});
