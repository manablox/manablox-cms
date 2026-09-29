<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import { useEnvironment } from '@manablox/admin-sdk/features/environments/useEnvironment';
import { useCan } from '@manablox/admin-sdk/lib/space';
import { PRODUCTION_ENVIRONMENT } from '@manablox/core';
import { computed } from 'vue';

/** Across the shell while a staging environment is open. */
const { machineName, production, current, switchTo } = useEnvironment();
const canManage = useCan('environment:manage');

const promoteTo = computed(() => ({
  path: '/settings',
  query: { tab: 'environments', promote: machineName.value, env: machineName.value },
}));
</script>

<template>
  <div
    v-if="!production"
    class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ochre-700/30 bg-ochre-500 px-4 py-1.5 text-sm text-ochre-900"
    role="status"
    data-testid="environment-bar"
  >
    <Icon name="layers" class="mb-icon-sm shrink-0" />
    <p class="min-w-0 flex-1">
      <span class="font-semibold">Staging: {{ current?.name ?? machineName }}</span>
      <span class="hidden sm:inline"> - changes here stay out of production until they are promoted.</span>
    </p>
    <RouterLink v-if="canManage" :to="promoteTo" class="font-medium underline">Promote</RouterLink>
    <button type="button" class="font-medium underline" @click="switchTo(PRODUCTION_ENVIRONMENT)">Back to production</button>
  </div>
</template>
