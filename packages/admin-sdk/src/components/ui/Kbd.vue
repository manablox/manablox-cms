<script setup lang="ts">
import { computed } from 'vue';
import { formatKeys } from '../../lib/shortcuts';

/** Renders a shortcut binding string as key caps: `mod+shift+z` is a chord, `g c` a sequence. */
const props = defineProps<{ keys: string }>();

const chords = computed(() => formatKeys(props.keys));
</script>

<template>
  <span class="inline-flex items-center gap-1 whitespace-nowrap">
    <template v-for="(chord, index) in chords" :key="index">
      <span v-if="index > 0" class="px-0.5 text-2xs text-surface-500">then</span>
      <kbd v-for="token in chord" :key="token" class="mb-kbd">{{ token }}</kbd>
    </template>
  </span>
</template>
