<script setup lang="ts">
import { computed } from 'vue';
import { copyText } from '../../lib/clipboard';
import Icon from '../Icon.vue';

/** A value as pretty JSON with a copy button; strings show as they are. */
const props = withDefaults(
  defineProps<{
    value: unknown;
    /** Names the copy button. */
    label?: string;
    /** Height cap class. */
    maxHeight?: string;
  }>(),
  { label: 'JSON', maxHeight: 'max-h-72' },
);

const text = computed(() =>
  typeof props.value === 'string' ? props.value : (JSON.stringify(props.value, null, 2) ?? ''),
);
</script>

<template>
  <div class="relative">
    <pre
      class="mb-surface-inset overflow-auto rounded-control p-2 pr-9 font-mono text-2xs text-surface-700 dark:text-surface-300"
      :class="maxHeight"
    >{{ text }}</pre>
    <button
      type="button"
      class="mb-btn-ghost mb-btn-icon mb-btn-sm absolute top-1 right-1"
      :aria-label="`Copy ${label}`"
      :title="`Copy ${label}`"
      @click="copyText(text)"
    >
      <Icon name="copy" class="mb-icon-sm" />
    </button>
  </div>
</template>
