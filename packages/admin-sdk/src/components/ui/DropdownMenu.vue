<script setup lang="ts">
import { watch } from 'vue';
import Popover from './Popover.vue';

/**
 * Popover menu that closes on a choice, with arrow/Home/End navigation. On close, focus
 * returns to the opener unless the choice navigated or moved focus elsewhere.
 */
const props = withDefaults(
  defineProps<{
    open: boolean;
    align?: 'start' | 'center' | 'end';
    class?: string | undefined;
  }>(),
  { align: 'end' },
);
const emit = defineEmits<{ 'update:open': [value: boolean] }>();

let navigated = false;
let opener: HTMLElement | null = null;

// Captured before reka-ui moves focus into the panel.
watch(
  () => props.open,
  (open) => {
    if (open)
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  },
);

function onClick(event: MouseEvent) {
  const item = (event.target as HTMLElement | null)?.closest('a, button');
  if (!item) return;
  navigated = item.tagName === 'A';
  emit('update:open', false);
}

function onCloseAutoFocus(event: Event) {
  const panel = event.target as HTMLElement | null;
  const active = document.activeElement;
  const movedOn = active !== null && active !== document.body && !panel?.contains(active);
  if (navigated || movedOn) {
    event.preventDefault();
  } else if (opener?.isConnected && opener !== document.body && !panel?.contains(opener)) {
    event.preventDefault();
    opener.focus({ preventScroll: true });
  }
  navigated = false;
  opener = null;
}

const STEPS: Record<string, (index: number, count: number) => number> = {
  ArrowDown: (index, count) => (index + 1) % count,
  // With nothing focused, up goes to the last item.
  ArrowUp: (index, count) => (Math.max(index, 0) - 1 + count) % count,
  Home: () => 0,
  End: (_, count) => count - 1,
};

function onKeydown(event: KeyboardEvent) {
  const step = STEPS[event.key];
  if (!step || event.altKey || event.ctrlKey || event.metaKey) return;
  const list = event.currentTarget as HTMLElement;
  const items = [...list.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)')];
  if (!items.length) return;
  event.preventDefault();
  const current = items.indexOf(document.activeElement as HTMLElement);
  items[step(current, items.length)]?.focus();
}
</script>

<template>
  <Popover
    :open="open"
    :align="align"
    :class="$props.class"
    @update:open="emit('update:open', $event)"
    @close-auto-focus="onCloseAutoFocus"
  >
    <template #trigger><slot name="trigger" /></template>
    <div @click="onClick" @keydown="onKeydown"><slot /></div>
  </Popover>
</template>
