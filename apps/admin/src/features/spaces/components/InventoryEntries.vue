<script setup lang="ts">
import ChipToggle from '@manablox/admin-sdk/components/ui/ChipToggle.vue';

/** An opened inventory row: a chip per entry, with All and None. */
defineProps<{
  entries: readonly { id: string; label: string }[];
  picked: ReadonlySet<string>;
  /** Ends the count line, as in "3 of 5 travel". */
  verb: string;
}>();
const emit = defineEmits<{ toggle: [id: string]; all: [on: boolean] }>();
</script>

<template>
  <div>
    <div class="mb-1 flex items-center justify-between gap-2">
      <p class="mb-label">{{ picked.size }} of {{ entries.length }} {{ verb }}</p>
      <span class="flex items-center gap-1">
        <button type="button" class="mb-btn-ghost mb-btn-sm" @click="emit('all', true)">All</button>
        <button type="button" class="mb-btn-ghost mb-btn-sm" @click="emit('all', false)">None</button>
      </span>
    </div>
    <div class="flex flex-wrap gap-1">
      <ChipToggle
        v-for="entry in entries"
        :key="entry.id"
        :model-value="picked.has(entry.id)"
        @update:model-value="emit('toggle', entry.id)"
      >
        {{ entry.label }}
      </ChipToggle>
    </div>
  </div>
</template>
