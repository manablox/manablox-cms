<script setup lang="ts">
import { Icon } from '@manablox/admin-sdk';
import type { StylePropName } from '@manablox/site';
import { computed } from 'vue';
import type { StyleEditor } from '../../model/style-visual';

/** A labelled style control; a dot marks a set value and the reset button clears it. */
const props = defineProps<{
  label: string;
  names: readonly StylePropName[];
  editor: StyleEditor;
  hint?: string | undefined;
  readOnly?: boolean;
}>();

const isSet = computed(() => props.names.some((name) => props.editor.value(name) !== undefined));

function reset() {
  props.editor.patch(Object.fromEntries(props.names.map((name) => [name, undefined])));
}
</script>

<template>
  <div class="ws:space-y-1.5">
    <div class="ws:flex ws:min-h-5 ws:items-center ws:gap-1.5">
      <span class="ws:text-xs ws:font-medium ws:text-surface-700 ws:dark:text-surface-300">{{ label }}</span>
      <span v-if="isSet" class="ws:h-1.5 ws:w-1.5 ws:rounded-pill ws:bg-brand-500" title="Set on this element" />
      <span class="ws:flex-1" />
      <button
        v-if="isSet && !readOnly"
        type="button"
        class="ws:rounded-control ws:p-0.5 ws:text-surface-400 ws:hover:bg-surface-100 ws:hover:text-surface-700 ws:dark:hover:bg-surface-800 ws:dark:hover:text-surface-200"
        :aria-label="`Reset ${label}`"
        :title="`Reset ${label.toLowerCase()} to the theme`"
        @click="reset"
      >
        <Icon name="reset" class="mb-icon-sm" />
      </button>
    </div>
    <slot />
    <p v-if="hint" class="ws:text-2xs ws:text-surface-500">{{ hint }}</p>
  </div>
</template>
