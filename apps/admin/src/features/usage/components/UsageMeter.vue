<script setup lang="ts">
import ProgressBar from '@manablox/admin-sdk/components/ui/ProgressBar.vue';
import { computed } from 'vue';
import { meterView, type UsageMeterData } from '../model';

/** One metric: used against its limit, with the level when a limit is set. */
const props = defineProps<{ meter: UsageMeterData }>();

const view = computed(() => meterView(props.meter));
const BADGES = {
  ok: 'mb-badge-ok',
  warn: 'mb-badge-warn',
  over: 'mb-badge-danger',
  blocked: 'mb-badge-danger',
};
</script>

<template>
  <div class="space-y-1.5 py-3">
    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <p class="text-sm font-medium">{{ view.label }}</p>
      <span v-if="view.level && view.levelLabel" :class="BADGES[view.level]">{{ view.levelLabel }}</span>
      <span class="flex-1" />
      <p class="text-sm tabular-nums">
        {{ view.used }}
        <span class="text-surface-500">{{ view.max === null ? 'this period, no limit' : `of ${view.max}` }}</span>
      </p>
    </div>
    <ProgressBar v-if="view.percent !== null" :value="view.percent" :label="`${view.label} used`" :tone="view.tone" />
    <p v-if="view.mode" class="mb-meta">
      {{ view.mode === 'hard' ? 'Stops at the limit.' : 'May pass the limit.' }}
      <span v-if="view.effect" class="mb-text-danger">{{ view.effect }}</span>
    </p>
  </div>
</template>
