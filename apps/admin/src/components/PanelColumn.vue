<script setup lang="ts">
import {
  type PanelKey,
  resizingPanel,
  usePanelWidth,
} from '@manablox/admin-sdk/composables/usePanel';
import { computed } from 'vue';
import PanelRail from '~/components/PanelRail.vue';

/** Animated wide-screen column that cross-fades between a side panel and its rail. */
const props = defineProps<{
  collapsed: boolean;
  label: string;
  /** Follow the resizable panel's width. */
  resize?: PanelKey | undefined;
}>();
const emit = defineEmits<{ expand: [] }>();

const width = usePanelWidth(props.resize ?? 'tree');
const style = computed(() =>
  props.resize && !props.collapsed ? { width: `${width.value}px` } : undefined,
);
</script>

<template>
  <div
    class="relative h-full shrink-0 overflow-hidden ease-[var(--mb-ease-out)] motion-reduce:transition-none [&>aside]:absolute [&>aside]:inset-y-0 [&>aside]:left-0"
    :class="[
      collapsed ? 'w-10' : resize ? '' : 'w-68',
      resizingPanel === resize ? '' : 'transition-[width] duration-[var(--mb-dur-slow)]',
    ]"
    :style="style"
  >
    <Transition name="panel-fade">
      <PanelRail v-if="collapsed" :label="label" @expand="emit('expand')" />
      <slot v-else />
    </Transition>
  </div>
</template>
