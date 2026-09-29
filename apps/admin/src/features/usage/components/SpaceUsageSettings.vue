<script setup lang="ts">
import PageState from '@manablox/admin-sdk/components/ui/PageState.vue';
import Panel from '@manablox/admin-sdk/components/ui/Panel.vue';
import PluginSlot from '~/components/PluginSlot';
import { useSpaceUsage } from '../queries';
import UsageScopes from './UsageScopes.vue';

/** Settings -> Usage: the space's usage this period against its limits. */
const { data, isPending, error, refetch } = useSpaceUsage();
</script>

<template>
  <Panel
    title="Usage"
    description="What this space used this period, counted about once a minute, against the limits of your plan."
    size="lg"
    :card="false"
  >
    <PageState :ready="Boolean(data)" :loading="isPending" :error="error" :retry="refetch" loading-label="Loading usage...">
      <UsageScopes v-if="data" :overview="data" :for-space="true" />
      <PluginSlot v-if="data" id="usage.lines" :props="{ usage: data }" />
    </PageState>
  </Panel>
</template>
