<script setup lang="ts">
import FeatureLock from '@manablox/admin-sdk/components/feature/FeatureLock.vue';
import Select from '@manablox/admin-sdk/components/ui/Select.vue';
import { switcherState } from '@manablox/admin-sdk/features/environments/model';
import { useEnvironment } from '@manablox/admin-sdk/features/environments/useEnvironment';
import { computed } from 'vue';

/** Picks the space's environment; hidden while production is the only one. */
const { machineName, production, environments, feature, switchTo } = useEnvironment();

const state = computed(() => switcherState(feature.value, environments.data.value));
const options = computed(() =>
  (environments.data.value ?? []).map((environment) => ({
    value: environment.machineName,
    label: environment.name,
    hint: environment.kind === 'production' ? 'production' : `staging - ${environment.machineName}`,
  })),
);
</script>

<template>
  <div v-if="state === 'select'" class="mt-1.5">
    <label class="sr-only" for="environment-select">Environment</label>
    <Select
      id="environment-select"
      variant="sm"
      :model-value="machineName"
      :options="options"
      :class="production ? '' : 'border-ochre-500 bg-ochre-50 dark:bg-ochre-500/15'"
      @update:model-value="switchTo($event)"
    />
  </div>
  <div v-else-if="state === 'locked'" class="mt-1.5">
    <FeatureLock feature="environments" :state="feature" label="Environments" trigger-class="mb-btn-ghost mb-btn-sm w-full justify-start" />
  </div>
</template>
