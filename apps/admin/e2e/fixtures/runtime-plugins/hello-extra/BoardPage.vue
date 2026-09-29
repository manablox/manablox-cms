<script setup lang="ts">
import { PageHeader, PluginSlot, pluginClient, useSpaceStore } from '@manablox/admin-sdk';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import type { HelloExtraRouter } from '../../../../../api/src/e2e/runtime-plugins';

const extra = pluginClient<HelloExtraRouter>('hello-extra');
const spaces = useSpaceStore();
const { data } = useQuery({
  queryKey: computed(() => ['hello-extra', 'board', spaces.currentId]),
  queryFn: () => extra.board.get({ spaceId: spaces.currentId as string }),
  enabled: computed(() => Boolean(spaces.currentId)),
});
</script>

<template>
  <div class="mb-page">
    <PageHeader title="Greeting board" eyebrow="Hello extra" description="Words from every plugin that greets here." />
    <ul aria-label="Words">
      <li v-for="word in data?.words ?? []" :key="word">{{ word }}</li>
    </ul>
    <section class="mb-card" aria-label="From other plugins">
      <PluginSlot id="hello-extra:board" :props="{ spaceId: spaces.currentId }" />
    </section>
  </div>
</template>
