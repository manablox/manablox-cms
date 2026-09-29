<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import { formatDate } from '@manablox/admin-sdk/lib/format';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed } from 'vue';
import { blockedEffect, usageBannerItems } from '../model';

/** Across the admin while a usage limit the viewer can see is used up. */
const session = useSessionStore();
const spaces = useSpaceStore();

const SHOWN = 3;
const items = computed(() => usageBannerItems(session.me, spaces.currentId));
const upgrade = computed(() => session.me?.controls.links.upgrade ?? null);

const where = (spaceId: string | null): string => {
  if (spaceId === null) return 'on this instance';
  const name = spaces.spaces.find((space) => space.id === spaceId)?.name;
  return name ? `in ${name}` : 'in a space';
};
</script>

<template>
  <div
    v-if="items.length"
    class="border-b border-danger-300 bg-danger-50 px-4 py-2 text-sm text-danger-900 dark:border-danger-500/40 dark:bg-danger-500/10 dark:text-danger-100"
    role="alert"
  >
    <div class="flex items-start gap-2">
      <Icon name="alert" class="mb-icon-sm mt-0.5 shrink-0" />
      <ul class="min-w-0 flex-1 space-y-0.5">
        <li v-for="item in items.slice(0, SHOWN)" :key="`${item.metric}:${item.spaceId ?? ''}`">
          <span class="font-semibold">{{ item.label }} used up {{ where(item.spaceId) }}</span>
          until {{ formatDate(item.resetsAt) }}. {{ blockedEffect(item.metric) }}
          <RouterLink :to="item.to" class="ml-1 font-medium underline" :aria-label="`${item.label} usage`">See usage</RouterLink>
        </li>
        <li v-if="items.length > SHOWN" class="text-xs">And {{ items.length - SHOWN }} more on the usage pages.</li>
      </ul>
      <a v-if="upgrade" :href="upgrade" target="_blank" rel="noopener" class="mb-btn-outline mb-btn-sm shrink-0">Upgrade</a>
    </div>
  </div>
</template>
