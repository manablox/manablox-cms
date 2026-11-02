<script setup lang="ts">
/**
 * A designer's workspace, filling the page: toolbar on top, then the left pane, the canvas
 * and the optional right pane. Below a wide container the panes stack and the page scrolls.
 */
withDefaults(defineProps<{ leftLabel?: string; rightLabel?: string }>(), {
  leftLabel: 'Elements',
  rightLabel: 'Inspector',
});
</script>

<template>
  <div class="ws:@container ws:h-full">
    <div class="ws:flex ws:min-h-full ws:flex-col ws:@6xl:h-full">
      <slot name="toolbar" />
      <div v-if="$slots.notices" class="ws:space-y-2 ws:border-b ws:border-surface-200 ws:px-3 ws:py-2 ws:empty:hidden ws:dark:border-surface-800 ws:[&>*]:mb-0"><slot name="notices" /></div>
      <div
        class="ws:grid ws:min-h-0 ws:flex-1 ws:grid-cols-1"
        :class="$slots.right
          ? 'ws:@6xl:grid-cols-[minmax(16rem,18rem)_minmax(0,1fr)_minmax(19rem,22rem)]'
          : 'ws:@6xl:grid-cols-[minmax(20rem,25rem)_minmax(0,1fr)]'"
      >
        <aside class="mb-designer-pane ws:@6xl:overflow-y-auto ws:@6xl:border-r ws:@6xl:border-b-0" :aria-label="leftLabel">
          <slot name="left" />
        </aside>
        <div class="ws:flex ws:h-[80vh] ws:min-w-0 ws:flex-col ws:@6xl:h-auto ws:@6xl:min-h-0">
          <slot name="center" />
        </div>
        <aside v-if="$slots.right" class="mb-designer-pane ws:@6xl:overflow-y-auto ws:@6xl:border-l ws:@6xl:border-b-0" :aria-label="rightLabel">
          <slot name="right" />
        </aside>
      </div>
    </div>
  </div>
</template>
