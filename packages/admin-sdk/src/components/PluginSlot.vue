<script setup lang="ts">
import { computed, onErrorCaptured } from 'vue';
import { type PluginSlotItem, useSlotEntries } from '../lib/plugin-slots';

/**
 * Renders the plugin entries of a slot: a plugin-declared one (`<id>:<name>`) or a core one.
 * Each entry gets `props` as its props; the default slot gets `items` to lay them out itself.
 * `locked` keeps entries whose feature is locked, for a default slot that draws the lock.
 */
const props = defineProps<{ id: string; props?: object; locked?: boolean }>();
defineSlots<{ default?: (scope: { items: readonly PluginSlotItem[] }) => unknown }>();

const gated = useSlotEntries(props.id, { locked: props.locked });
const items = computed(() =>
  gated.value.filter(
    (item) => !item.entry.when || (props.props !== undefined && item.entry.when(props.props)),
  ),
);

// A failing entry must not take the page down.
onErrorCaptured((error) => {
  console.error(`plugin slot ${props.id} failed`, error);
  return false;
});
</script>

<template>
  <slot v-if="$slots.default" :items="items" />
  <template v-else>
    <component :is="item.component" v-for="item in items" :key="item.key" v-bind="props.props ?? {}" />
  </template>
</template>
