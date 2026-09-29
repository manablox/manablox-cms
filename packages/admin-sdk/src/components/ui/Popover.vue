<script setup lang="ts">
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui';

/** reka-ui popover anchored to the `trigger` slot (a single element). */
withDefaults(
  defineProps<{
    open: boolean;
    align?: 'start' | 'center' | 'end';
    side?: 'top' | 'bottom' | 'left' | 'right';
    /** Extra panel classes. */
    class?: string | undefined;
  }>(),
  { align: 'start', side: 'bottom' },
);
const emit = defineEmits<{
  'update:open': [value: boolean];
  /** `preventDefault` keeps focus from returning to the trigger. */
  'close-auto-focus': [event: Event];
}>();
</script>

<template>
  <PopoverRoot :open="open" @update:open="emit('update:open', $event)">
    <PopoverTrigger as-child>
      <slot name="trigger" />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        class="mb-popover mb-anim-pop max-h-[var(--reka-popover-content-available-height)]"
        :class="$props.class"
        :align="align"
        :side="side"
        :side-offset="6"
        :collision-padding="8"
        @close-auto-focus="emit('close-auto-focus', $event)"
      >
        <slot />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
