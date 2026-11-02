<script setup lang="ts">
import { Icon, plural } from '@manablox/admin-sdk';
import { computed } from 'vue';
import { DESIGN_AREAS, isDirty } from '../model/status';
import type { SiteDesignSummary } from '../queries';

/** The overview's map of the design: a card per part, what it controls and where it stands. */
const props = defineProps<{ designs: readonly SiteDesignSummary[] }>();

const TILES = {
  clay: 'mb-tile-clay',
  iris: 'mb-tile-iris',
  ochre: 'mb-tile-ochre',
  sand: 'mb-tile-sand',
};

const cards = computed(() =>
  DESIGN_AREAS.map((area) => {
    const entries = props.designs.filter((entry) => entry.kind === area.kind);
    const pending = entries.filter((entry) => isDirty(entry.status)).length;
    const changed = entries.filter((entry) => entry.status !== 'generated').length;
    const single = area.kind === 'theme' || area.kind === 'site';
    let state: { text: string; tone: string };
    if (pending) state = { text: `${pending} not published`, tone: 'mb-badge-warn' };
    else if (changed) state = { text: 'live', tone: 'mb-badge-ok' };
    else state = { text: 'automatic', tone: 'mb-badge' };
    return {
      ...area,
      count: single ? null : plural(entries.length, 'design'),
      state,
    };
  }),
);
</script>

<template>
  <div class="ws:grid ws:gap-3 ws:sm:grid-cols-2 ws:xl:grid-cols-3">
    <RouterLink
      v-for="card in cards"
      :key="card.kind"
      :to="card.to"
      class="mb-card ws:group ws:flex ws:flex-col ws:gap-3 ws:transition-shadow ws:hover:shadow-pop ws:focus-visible:outline-2 ws:focus-visible:outline-brand-500"
      :aria-label="`${card.label}: ${card.blurb}`"
    >
      <div class="ws:flex ws:items-center ws:gap-3">
        <span class="ws:flex ws:h-10 ws:w-10 ws:shrink-0 ws:items-center ws:justify-center ws:rounded-card" :class="TILES[card.tile]">
          <Icon :name="card.icon" class="mb-icon-lg" />
        </span>
        <div class="ws:min-w-0 ws:flex-1">
          <h3 class="ws:truncate ws:text-base ws:font-bold ws:group-hover:text-brand-700 ws:dark:group-hover:text-brand-300">{{ card.label }}</h3>
          <p v-if="card.count" class="ws:text-2xs ws:text-surface-500">{{ card.count }}</p>
        </div>
      </div>
      <p class="ws:flex-1 ws:text-sm ws:text-surface-600 ws:dark:text-surface-400">{{ card.blurb }}</p>
      <div class="ws:flex ws:items-center ws:justify-between ws:gap-2">
        <span class="ws:inline-flex ws:items-center ws:gap-1 ws:text-sm ws:font-medium ws:text-brand-700 ws:dark:text-brand-300">
          Open <Icon name="arrow-left" class="mb-icon-sm ws:rotate-180 ws:transition-transform ws:group-hover:translate-x-0.5" />
        </span>
        <span :class="card.state.tone" class="ws:shrink-0">{{ card.state.text }}</span>
      </div>
    </RouterLink>
  </div>
</template>
