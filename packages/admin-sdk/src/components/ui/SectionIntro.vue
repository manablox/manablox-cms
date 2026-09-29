<script setup lang="ts">
import Icon from '../Icon.vue';

/** A landing card's intro: tile icon, heading with a count, blurb and actions. */
withDefaults(
  defineProps<{
    icon: string;
    title: string;
    count?: number | string | undefined;
    tile?: 'clay' | 'iris' | 'ochre' | 'sand';
    /** Falls back to the default slot, for blurbs with links. */
    blurb?: string | undefined;
    /** Tile above the heading, for cards in a grid. */
    stacked?: boolean;
  }>(),
  { tile: 'clay', stacked: false },
);

const TILES = {
  clay: 'mb-tile-clay',
  iris: 'mb-tile-iris',
  ochre: 'mb-tile-ochre',
  sand: 'mb-tile-sand',
};
</script>

<template>
  <div :class="stacked ? 'flex flex-col gap-3' : 'space-y-3'">
    <div :class="stacked ? 'contents' : 'flex flex-wrap items-center gap-3'">
      <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-card" :class="TILES[tile]">
        <Icon :name="icon" class="mb-icon-lg" />
      </span>
      <h2 class="flex items-center gap-2 text-base font-bold">
        {{ title }}
        <span v-if="count !== undefined" class="mb-badge">{{ count }}</span>
      </h2>
      <template v-if="$slots.actions && !stacked">
        <span class="flex-1" />
        <div class="flex flex-wrap items-center gap-2"><slot name="actions" /></div>
      </template>
    </div>
    <p v-if="blurb || $slots.default" class="text-sm text-surface-500">
      <slot>{{ blurb }}</slot>
    </p>
    <div v-if="$slots.actions && stacked" class="flex flex-wrap gap-2"><slot name="actions" /></div>
  </div>
</template>
