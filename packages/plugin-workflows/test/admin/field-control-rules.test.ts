import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

vi.mock('@manablox/admin-sdk/stores/space', () => ({
  useSpaceStore: () => ({ currentId: 's1', contentTypes: [], current: { locales: [] } }),
}));
// The content type picker's query; the rules kind does not read it.
vi.mock('@manablox/admin-sdk/features/content-types/queries', async (original) => ({
  ...(await original<object>()),
  useContentTypes: () => ({ data: ref([]) }),
}));

import type { ErrorFor } from '@manablox/admin-sdk/composables/useDraftForm';
import FieldControl from '../../src/admin/components/FieldControl.vue';
import RuleList from '../../src/admin/components/RuleList.vue';
import type { WorkflowCatalog } from '../../src/admin/queries';
import type { WorkflowFieldSpec, WorkflowRuleSet } from '../../src/sdk';

const spec: WorkflowFieldSpec = { name: 'filter', label: 'Only for', kind: 'rules' };
const catalog = {
  operators: [
    { id: 'equals', label: 'is' },
    { id: 'isEmpty', label: 'is empty' },
  ],
} as WorkflowCatalog;

function render(value: unknown, errorFor: ErrorFor = () => null) {
  return mount(FieldControl, {
    props: {
      spec,
      value,
      config: {},
      readOnly: false,
      hints: [],
      catalog,
      errorFor,
      id: 'node-a-filter',
    },
  });
}

const updates = (wrapper: ReturnType<typeof render>) =>
  (wrapper.emitted('update') ?? []).map(([value]) => value as WorkflowRuleSet);

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('FieldControl rules kind', () => {
  it('starts an unset field with no rules and adds one', async () => {
    const wrapper = render(undefined);
    const list = wrapper.getComponent(RuleList);
    expect(list.props('match')).toBe('all');
    expect(list.props('rules')).toEqual([]);

    const add = wrapper.findAll('button').find((button) => button.text().includes('Add rule'));
    await add?.trigger('click');
    expect(updates(wrapper)).toEqual([
      { match: 'all', rules: [{ field: 'content.status', operator: 'equals', value: '' }] },
    ]);
  });

  it('edits a rule of the set it is given', async () => {
    const value: WorkflowRuleSet = {
      match: 'any',
      rules: [{ field: 'content.status', operator: 'equals', value: 'draft' }],
    };
    const wrapper = render(value);
    await wrapper.get('input[aria-label="Rule 1: expected"]').setValue('published');
    expect(updates(wrapper).at(-1)).toEqual({
      match: 'any',
      rules: [{ field: 'content.status', operator: 'equals', value: 'published' }],
    });
  });

  it('keeps the rules when the match changes', () => {
    const value: WorkflowRuleSet = {
      match: 'all',
      rules: [{ field: 'content.title', operator: 'isEmpty', value: '' }],
    };
    const wrapper = render(value);
    wrapper.getComponent(RuleList).vm.$emit('update', { match: 'any' });
    expect(updates(wrapper)).toEqual([{ ...value, match: 'any' }]);
  });

  it("shows the errors under the field's own path", () => {
    const wrapper = render(
      { match: 'all', rules: [{ field: '', operator: 'equals', value: '' }] },
      (path) => (path.join('.') === 'rules.0.field' ? 'A value to check is required' : null),
    );
    expect(wrapper.text()).toContain('A value to check is required');
  });
});
