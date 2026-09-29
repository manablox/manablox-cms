<script setup lang="ts">
import { type ErrorFor, NumberField, SegmentedControl, TextField } from '@manablox/admin-sdk';
import { computed } from 'vue';
import {
  WORKFLOW_MAX_LOOP_ITEMS,
  type WorkflowLoopMode,
  type WorkflowNodeOf,
  type WorkflowRuleSet,
} from '../../../sdk';
import type { PlaceholderHint } from '../../model';
import type { WorkflowCatalog } from '../../queries';
import PlaceholderComplete from '../PlaceholderComplete.vue';
import PlaceholderHelp from '../PlaceholderHelp.vue';
import RuleList from '../RuleList.vue';

type Loop = WorkflowNodeOf<'loop'>;

/** How a loop node decides its passes: a list, a count, or rules that end it. */
const props = defineProps<{
  node: Loop;
  readOnly: boolean;
  hints: PlaceholderHint[];
  /** What the repeat rules may read: the loop's own branch too. */
  untilHints: PlaceholderHint[];
  catalog: WorkflowCatalog | undefined;
  /** Errors under the node. */
  errorFor: ErrorFor;
}>();
const emit = defineEmits<{ update: [node: Loop] }>();

const patch = (change: Partial<Loop>) => emit('update', { ...props.node, ...change });

const MODES = [
  { value: 'items', label: 'Each item' },
  { value: 'count', label: 'Times' },
  { value: 'until', label: 'Until' },
] as const;

const mode = computed(() => props.node.mode ?? 'items');
const until = computed<WorkflowRuleSet>(() => props.node.until ?? { match: 'all', rules: [] });

function setMode(next: WorkflowLoopMode) {
  if (next === 'until' && !until.value.rules.length) {
    patch({
      mode: next,
      until: { match: 'all', rules: [{ field: '', operator: 'isEmpty', value: '' }] },
    });
  } else patch({ mode: next });
}

const untilErrors: ErrorFor = (path) => props.errorFor(['until', ...path]);
</script>

<template>
  <PlaceholderComplete :hints="hints" class="wf:grid wf:gap-4 wf:sm:grid-cols-2">
    <SegmentedControl
      :model-value="mode"
      :options="MODES"
      :columns="3"
      :disabled="readOnly"
      aria-label="How the loop repeats"
      class="wf:sm:col-span-2"
      @update:model-value="setMode"
    />

    <TextField
      v-if="mode === 'items'"
      label="Go through"
      field-class="wf:sm:col-span-2"
      :model-value="node.items"
      class="wf:font-mono wf:text-xs"
      placeholder="{{ nodes.write.json }}"
      :readonly="readOnly"
      :error="errorFor(['items'])"
      @update:model-value="patch({ items: String($event ?? '') })"
    >
      <template #actions><PlaceholderHelp :hints="hints" /></template>
      <template #hint>
        <p class="wf:mt-1 mb-meta">A list from an earlier node. Empty takes the list the previous node produced. Inside the loop, <span v-pre class="wf:font-mono">{{ item }}</span> is the current item.</p>
      </template>
    </TextField>

    <TextField
      v-else-if="mode === 'count'"
      label="Repeat"
      field-class="wf:sm:col-span-2"
      :model-value="node.count"
      class="wf:font-mono wf:text-xs"
      placeholder="3, or {{ input.times }}"
      :readonly="readOnly"
      :error="errorFor(['count'])"
      @update:model-value="patch({ count: String($event ?? '') })"
    >
      <template #actions><PlaceholderHelp :hints="hints" /></template>
      <template #hint>
        <p class="wf:mt-1 mb-meta">How many times, as a number or a placeholder for one. Inside the loop, <span v-pre class="wf:font-mono">{{ loop.index }}</span> counts from 0.</p>
      </template>
    </TextField>

    <div v-else class="wf:space-y-2 wf:sm:col-span-2">
      <RuleList
        :match="until.match"
        :rules="until.rules"
        lead="Stop repeating once"
        :read-only="readOnly"
        :hints="untilHints"
        :catalog="catalog"
        :error-for="untilErrors"
        @update="patch({ until: { ...until, ...$event } })"
      />
      <p class="mb-meta">Checked after each pass, so the rules can read what the pass produced, like <span v-pre class="wf:font-mono">nodes.fetch.body.next</span>.</p>
    </div>

    <NumberField
      :model-value="node.maxItems"
      :label="mode === 'items' ? 'At most (items)' : 'At most (times)'"
      field-class="wf:sm:col-span-2"
      :hint="mode === 'items' ? 'Items past this are left out.' : mode === 'count' ? 'Repeats past this are left out.' : 'The loop ends here even if the rules never hold.'"
      class="wf:w-32"
      :min="1"
      :max="WORKFLOW_MAX_LOOP_ITEMS"
      :readonly="readOnly"
      :error="errorFor(['maxItems'])"
      @update:model-value="$event != null && patch({ maxItems: $event })"
    />
  </PlaceholderComplete>
</template>
