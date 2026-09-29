<script setup lang="ts">
import { computed } from 'vue';
import { type PanelKey, usePanelWidth } from '../../composables/usePanel';
import IconButton from '../ui/IconButton.vue';
import PanelResizer from './PanelResizer.vue';

/** Shared side column frame: header, action and filter slots, scrolling body. */
const props = defineProps<{
  /** Also names the hide button. */
  label: string;
  /** Label link target. */
  to?: string | undefined;
  hideLabel?: boolean;
  /** Key for the remembered width; enables the drag handle. */
  resize?: PanelKey | undefined;
}>();
const emit = defineEmits<{ hide: [] }>();

const width = usePanelWidth(props.resize ?? 'tree');
const style = computed(() => (props.resize ? { width: `${width.value}px` } : undefined));
</script>

<template>
  <aside
    class="mb-surface-panel relative flex shrink-0 flex-col border-r border-surface-200 dark:border-surface-800"
    :class="resize ? '' : 'w-68'"
    :style="style"
  >
    <div class="flex items-center gap-2 px-3 pt-4 pb-2">
      <RouterLink v-if="to && !hideLabel" :to="to" class="mb-eyebrow flex-1 hover:underline">{{ label }}</RouterLink>
      <span v-else class="flex-1" aria-hidden="true" />
      <IconButton icon="panel-close" :label="`Hide ${label.toLowerCase()}`" class="-my-1" @click="emit('hide')" />
      <slot name="action" />
    </div>

    <slot name="filter" />

    <div class="min-h-0 flex-1 overflow-auto px-2 pb-3">
      <slot />
    </div>

    <PanelResizer v-if="resize" :panel="resize" :label="label" />
  </aside>
</template>
