<script setup lang="ts">
import { Icon, TextField, useSpaceStore } from '@manablox/admin-sdk';
import { computed } from 'vue';
import { switchCaseLabel, type WorkflowNode } from '../../sdk';
import { CONTROL_NODES, describeTrigger, triggerKind, type WorkflowDesign } from '../model';
import type { WorkflowCatalog } from '../queries';

/** A designed workflow for review before it is created: its name, trigger, steps and problems. */
const props = defineProps<{
  design: WorkflowDesign;
  catalog: WorkflowCatalog | undefined;
  /** The name's error from a failed create. */
  nameError?: string | null | undefined;
}>();
const name = defineModel<string>('name', { required: true });

const spaces = useSpaceStore();

const actionLabel = (type: string) =>
  props.catalog?.actions.find((action) => action.type === type)?.label ?? type;

/** What a node does, in a few words. */
function what(node: WorkflowNode): string {
  switch (node.kind) {
    case 'action':
      return actionLabel(node.action);
    case 'delay':
      return `Wait ${node.minutes} minutes`;
    case 'loop':
      if (node.mode === 'count') return `Repeat ${node.count} times`;
      if (node.mode === 'until') return 'Repeat until its rules hold';
      return `For each item of ${node.items || 'the previous list'}`;
    case 'switch':
      return `Switch on ${node.field}: ${node.cases.map(switchCaseLabel).join(', ')}`;
    case 'stop':
      return node.outcome === 'failed' ? 'Fail the run' : 'End the run';
    case 'call':
      return CONTROL_NODES.call.label;
    case 'condition':
      return `If ${node.rules.map((rule) => `${rule.field} ${rule.operator} ${rule.value}`.trim()).join(node.match === 'any' ? ' or ' : ' and ')}`;
  }
}

const steps = computed(() =>
  props.design.nodes.map((node) => ({
    id: node.id,
    key: node.key,
    icon: node.kind === 'action' ? 'zap' : CONTROL_NODES[node.kind].icon,
    what: what(node),
    name: node.name,
  })),
);

const kind = computed(() => triggerKind(props.design.trigger.kind, props.catalog));

const triggerSummary = computed(() =>
  describeTrigger(props.design.trigger, props.catalog, (id) => spaces.typeById(id)?.label),
);
</script>

<template>
  <div class="wf:space-y-3">
    <TextField v-model="name" label="Name" required :error="nameError" />
    <p v-if="design.notes" class="mb-callout wf:text-sm">{{ design.notes }}</p>
    <div class="wf:rounded-card wf:border wf:border-surface-200 wf:text-sm wf:dark:border-surface-800">
      <p class="wf:flex wf:items-center wf:gap-2 wf:border-b wf:border-surface-200 wf:p-2 wf:font-medium wf:dark:border-surface-800">
        <Icon :name="kind.icon" class="wf:text-brand-600 wf:dark:text-brand-300" /> {{ triggerSummary }}
      </p>
      <ol class="mb-list-divided">
        <li v-for="step in steps" :key="step.id" class="wf:flex wf:items-start wf:gap-2 wf:p-2">
          <Icon :name="step.icon" class="wf:mt-0.5 wf:shrink-0 wf:text-surface-500" />
          <span class="wf:min-w-0">
            <span class="wf:block">{{ step.name || step.what }}</span>
            <span class="wf:block wf:font-mono wf:text-2xs wf:text-surface-500">{{ step.key }} - {{ step.what }}</span>
          </span>
        </li>
      </ol>
    </div>
    <details v-if="design.problems.length" class="mb-meta">
      <summary class="wf:cursor-pointer">
        {{ design.problems.length }} {{ design.problems.length === 1 ? 'problem' : 'problems' }} the model could not resolve - it will not save until they are gone
      </summary>
      <ul class="wf:mt-1 wf:list-disc wf:space-y-0.5 wf:pl-5">
        <li v-for="problem in design.problems" :key="problem">{{ problem }}</li>
      </ul>
    </details>
  </div>
</template>
