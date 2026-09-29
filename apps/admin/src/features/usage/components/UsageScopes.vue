<script setup lang="ts">
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { computed } from 'vue';
import { periodLabel, scopeHint, scopeTitle } from '../model';
import type { UsageOverview } from '../queries';
import UsageMeter from './UsageMeter.vue';

/** The meters of each scope in an overview, with the period and the upgrade link. */
const props = defineProps<{ overview: UsageOverview; forSpace: boolean }>();

const session = useSessionStore();
const upgrade = computed(() => session.me?.controls.links.upgrade ?? null);
const limited = computed(() =>
  props.overview.scopes.some((scope) => scope.metrics.some((meter) => meter.limit !== null)),
);
</script>

<template>
  <div class="space-y-4">
    <p class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-surface-500">
      <span>This period: {{ periodLabel(overview) }}</span>
      <a v-if="upgrade && limited" :href="upgrade" target="_blank" rel="noopener" class="mb-link">Raise the limits</a>
    </p>
    <section
      v-for="scope in overview.scopes"
      :key="`${scope.kind}:${scope.spaceId ?? ''}`"
      class="mb-card"
      :aria-label="scopeTitle(scope)"
    >
      <h3 class="text-sm font-bold">{{ scopeTitle(scope) }}</h3>
      <p v-if="scopeHint(scope, forSpace)" class="mb-meta">{{ scopeHint(scope, forSpace) }}</p>
      <div class="mb-list-divided">
        <UsageMeter v-for="meter in scope.metrics" :key="meter.metric" :meter="meter" />
      </div>
    </section>
  </div>
</template>
