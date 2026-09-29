<script setup lang="ts">
/** Editor body: main column plus aside (side by side from `lg`); `sheet` makes the aside a bottom sheet. */
withDefaults(defineProps<{ sheet?: boolean }>(), { sheet: false });
</script>

<template>
  <div class="flex flex-col gap-4 sm:gap-6 lg:flex-row">
    <div class="min-w-0 flex-1 space-y-4"><slot /></div>
    <aside
      v-if="$slots.aside"
      class="w-full shrink-0 space-y-4 lg:w-80"
      :class="sheet ? 'mb-aside-sheet overflow-y-auto lg:overflow-visible' : ''"
    >
      <slot name="aside" />
    </aside>
  </div>
</template>
