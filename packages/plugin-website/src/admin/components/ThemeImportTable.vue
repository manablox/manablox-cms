<script setup lang="ts">
import { Checkbox } from '@manablox/admin-sdk';
import { computed } from 'vue';
import { importRows, importSummary, toggleSkip } from '../model/theme-bundle';
import type { ThemeImportReport } from '../queries';

/**
 * What a theme import does per design, with the notices of its report. `choosable` adds a
 * checkbox per entry that fills `skip`.
 */
const props = withDefaults(
  defineProps<{ report: ThemeImportReport; choosable?: boolean; done?: boolean }>(),
  { choosable: false, done: false },
);
const skip = defineModel<string[]>('skip', { default: () => [] });

const rows = computed(() => importRows(props.report));
</script>

<template>
  <div class="ws:space-y-2">
    <p class="ws:text-sm ws:font-medium" aria-live="polite">{{ importSummary(report, done) }}</p>
    <ul class="mb-list-divided ws:rounded-card ws:border ws:border-surface-200 ws:text-sm ws:dark:border-surface-800">
      <li v-for="row in rows" :key="row.key" class="ws:flex ws:items-start ws:gap-3 ws:p-2">
        <Checkbox
          v-if="choosable"
          :model-value="!skip.includes(row.key)"
          :disabled="!row.choosable"
          :aria-label="`Import ${row.kind} ${row.label}`"
          align="start"
          @update:model-value="skip = toggleSkip(skip, row.key, $event)"
        />
        <span class="ws:min-w-0 ws:flex-1">
          <span class="mb-meta">{{ row.kind }}</span>
          <span class="ws:ml-1.5 ws:font-medium">{{ row.label }}</span>
          <span v-if="row.note" class="ws:block mb-meta">{{ row.note }}</span>
        </span>
        <span :class="row.tone" class="ws:shrink-0">{{ row.actionLabel }}</span>
      </li>
    </ul>
    <p v-if="report.codeSkipped" class="mb-callout ws:text-xs" role="status">
      The file carries custom CSS or head code. Changing it needs the right to edit custom CSS and head code, so this space keeps its own.
    </p>
    <p v-if="report.missingAssets.length" class="mb-callout ws:text-xs" role="status">
      {{ report.missingAssets.length === 1 ? 'One file' : `${report.missingAssets.length} files` }} the designs use (fonts, logo or background images) are not in this space's assets. Those parts fall back until you pick new ones.
    </p>
  </div>
</template>
