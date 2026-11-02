<script setup lang="ts">
import { Icon } from '@manablox/admin-sdk';
import type { BrokenBinding, SiteIssue } from '@manablox/site';
import type { DesignField } from '../model/bindings';

/** Fields no element shows, bindings to removed fields and validation issues, each actionable. */
withDefaults(
  defineProps<{
    unplaced: readonly DesignField[];
    broken: readonly BrokenBinding[];
    issues: readonly SiteIssue[];
    readOnly: boolean;
    /** What the fields belong to, for the sentences. */
    owner?: string;
    /** Further problems, one sentence each. */
    notes?: readonly string[];
  }>(),
  { owner: 'block type', notes: () => [] },
);
const emit = defineEmits<{
  placeField: [fieldId: string];
  selectNode: [nodeId: string];
  selectIssue: [path: string];
}>();
</script>

<template>
  <div v-if="unplaced.length || broken.length || issues.length || notes.length" class="ws:space-y-3 ws:text-xs">
    <ul v-if="notes.length" class="ws:space-y-0.5 ws:text-warn-700 ws:dark:text-warn-300">
      <li v-for="(note, index) in notes" :key="index">{{ note }}</li>
    </ul>
    <div v-if="unplaced.length">
      <p class="mb-eyebrow ws:mb-1">Not shown ({{ unplaced.length }})</p>
      <p class="ws:mb-1.5 ws:text-surface-500">These fields have values nobody sees. Add an element for each, or leave them out on purpose.</p>
      <div class="ws:flex ws:flex-wrap ws:gap-1">
        <button
          v-for="field in unplaced"
          :key="field.id"
          type="button"
          class="mb-btn-outline mb-btn-sm"
          :disabled="readOnly"
          :title="`Add an element that shows ${field.label || field.name}`"
          @click="emit('placeField', field.id)"
        >
          <Icon name="plus" class="mb-icon-sm" /> {{ field.label || field.name }}
        </button>
      </div>
    </div>
    <div v-if="broken.length">
      <p class="mb-eyebrow ws:mb-1">Broken bindings ({{ broken.length }})</p>
      <ul class="ws:space-y-0.5">
        <li v-for="entry in broken" :key="`${entry.nodeId}:${entry.field}`">
          <button type="button" class="ws:text-left ws:text-warn-700 ws:hover:underline ws:dark:text-warn-300" @click="emit('selectNode', entry.nodeId)">
            An element shows <span class="ws:font-mono">{{ entry.field }}</span>, which the {{ owner }} no longer has.
          </button>
        </li>
      </ul>
    </div>
    <div v-if="issues.length">
      <p class="mb-eyebrow ws:mb-1">Problems ({{ issues.length }})</p>
      <ul class="ws:space-y-0.5">
        <li v-for="(issue, index) in issues.slice(0, 12)" :key="index">
          <button type="button" class="ws:text-left ws:text-danger-700 ws:hover:underline ws:dark:text-danger-300" @click="emit('selectIssue', issue.path)">
            <span class="ws:font-mono">{{ issue.path }}</span> {{ issue.message }}
          </button>
        </li>
      </ul>
    </div>
  </div>
  <p v-else class="ws:flex ws:items-start ws:gap-1.5 mb-meta">
    <Icon name="check" class="mb-icon-sm ws:mt-px ws:shrink-0 ws:text-ok-500" /> Every field is shown and nothing is broken.
  </p>
</template>
