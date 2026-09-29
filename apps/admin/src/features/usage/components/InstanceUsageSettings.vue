<script setup lang="ts">
import PageState from '@manablox/admin-sdk/components/ui/PageState.vue';
import Panel from '@manablox/admin-sdk/components/ui/Panel.vue';
import { useInstanceUsage } from '../queries';
import UsageScopes from './UsageScopes.vue';

/** Settings -> Instance usage: the whole instance and every space this period. */
const { data, isPending, error, refetch } = useInstanceUsage();
</script>

<template>
  <Panel
    title="Instance usage"
    description="What the instance and each space used this period, counted about once a minute, against the limits of your plan."
    size="lg"
    :card="false"
  >
    <PageState :ready="Boolean(data)" :loading="isPending" :error="error" :retry="refetch" loading-label="Loading usage...">
      <UsageScopes v-if="data" :overview="data" :for-space="false" />
    </PageState>
  </Panel>
</template>
