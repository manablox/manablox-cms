<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import IconButton from '@manablox/admin-sdk/components/ui/IconButton.vue';
import {
  dismiss,
  holdToasts,
  releaseToasts,
  type Toast,
  toasts,
} from '@manablox/admin-sdk/lib/toast';
import { ref } from 'vue';

/** Toast stack, mounted once in `App`. Hover or focus pauses every timer. */
const STYLE = {
  success: { icon: 'check', tile: 'mb-toast-tile-ok', fuse: 'bg-ok-500', label: 'Done' },
  error: { icon: 'alert', tile: 'mb-toast-tile-danger', fuse: 'bg-danger-500', label: 'Error' },
  info: { icon: 'bell', tile: 'mb-tile-iris', fuse: 'bg-iris-400', label: 'Notice' },
} as const;

/** Splits out `"quoted"` names for display styling. */
function runs(message: string): { text: string; name: boolean }[] {
  return message
    .split(/"([^"]+)"/)
    .map((text, index) => ({ text, name: index % 2 === 1 }))
    .filter((run) => run.text);
}

const hovered = ref(false);
const focused = ref(false);

function sync() {
  if (hovered.value || focused.value) holdToasts();
  else releaseToasts();
}

function onPointer(inside: boolean) {
  hovered.value = inside;
  sync();
}

function onFocusOut(event: FocusEvent) {
  const stack = event.currentTarget as HTMLElement;
  focused.value = stack.contains(event.relatedTarget as Node | null);
  sync();
}

function onFocusIn() {
  focused.value = true;
  sync();
}

// Errors interrupt screen readers; others are polite.
const roleOf = (item: Toast) => (item.kind === 'error' ? 'alert' : 'status');
</script>

<template>
  <div
    class="mb-z-toast pointer-events-none fixed right-4 bottom-4 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
    :class="hovered || focused ? 'mb-toast-held' : ''"
    aria-live="polite"
    aria-atomic="false"
    @mouseenter="onPointer(true)"
    @mouseleave="onPointer(false)"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
  >
    <TransitionGroup
      enter-active-class="mb-toast-enter-active"
      enter-from-class="mb-toast-enter-from"
      leave-active-class="mb-toast-leave-active"
      leave-to-class="mb-toast-leave-to"
      move-class="mb-toast-move"
    >
      <div
        v-for="item in toasts"
        :key="item.id"
        :role="roleOf(item)"
        class="mb-toast pointer-events-auto relative flex items-center gap-2.5 overflow-hidden rounded-popover border border-surface-200 bg-surface-0 py-2 pr-1.5 pl-2 text-surface-900 shadow-pop dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100"
      >
        <span
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-control"
          :class="STYLE[item.kind].tile"
        >
          <Icon :name="STYLE[item.kind].icon" class="mb-icon" />
          <span class="sr-only">{{ STYLE[item.kind].label }}:</span>
        </span>

        <p class="min-w-0 flex-1 text-sm leading-snug font-medium break-words">
          <template v-for="(run, index) in runs(item.message)" :key="index">
            <span v-if="run.name" class="mb-toast-name">{{ run.text }}</span>
            <template v-else>{{ run.text }}</template>
          </template>
        </p>

        <IconButton icon="x" label="Dismiss" class="shrink-0 self-start text-surface-400" @click="dismiss(item.id)" />

        <span
          class="mb-toast-fuse"
          :class="STYLE[item.kind].fuse"
          :style="{ animationDuration: `${item.duration}ms` }"
          aria-hidden="true"
        />
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
/* Ok and danger tiles, which the `.mb-tile-*` set lacks. */
.mb-toast-tile-ok {
  background: color-mix(in oklab, var(--color-ok-500) 16%, transparent);
  color: var(--color-ok-700);
}
.mb-toast-tile-danger {
  background: var(--color-danger-100);
  color: var(--color-danger-700);
}
/* Plain `.dark`: scoped CSS drops everything after `:global(.dark)`. */
.dark .mb-toast-tile-ok {
  background: color-mix(in oklab, var(--color-ok-500) 22%, transparent);
  color: color-mix(in oklab, var(--color-ok-500) 55%, white);
}
.dark .mb-toast-tile-danger {
  background: color-mix(in oklab, var(--color-danger-500) 22%, transparent);
  color: var(--color-danger-100);
}

/* Quotes drawn in CSS so the message stays a plain string. */
.mb-toast-name {
  font-family: var(--font-display);
  font-weight: 650;
  letter-spacing: -0.01em;
}
.mb-toast-name::before,
.mb-toast-name::after {
  color: var(--color-surface-400);
  font-weight: 500;
}
.mb-toast-name::before {
  content: "\201C";
}
.mb-toast-name::after {
  content: "\201D";
}

/* Countdown bar along the bottom edge. */
.mb-toast-fuse {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  height: 2px;
  transform-origin: left center;
  opacity: 0.7;
  animation-name: mb-toast-fuse;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}
.mb-toast-held .mb-toast-fuse {
  animation-play-state: paused;
}
@keyframes mb-toast-fuse {
  from {
    transform: scaleX(1);
  }
  to {
    transform: scaleX(0);
  }
}

.mb-toast-enter-active {
  transition:
    opacity var(--mb-dur-slow) var(--mb-ease-out),
    transform var(--mb-dur-slow) var(--mb-ease-out);
}
.mb-toast-enter-from {
  opacity: 0;
  transform: translate(0.75rem, 0.25rem) scale(0.98);
}
.mb-toast-leave-active {
  transition:
    opacity var(--mb-dur-fast) var(--mb-ease-in),
    transform var(--mb-dur-fast) var(--mb-ease-in);
}
.mb-toast-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
.mb-toast-move {
  transition: transform var(--mb-dur) var(--mb-ease-out);
}

@media (prefers-reduced-motion: reduce) {
  /* The timer still runs, just not drawn. */
  .mb-toast-fuse {
    visibility: hidden;
  }
  .mb-toast-enter-from,
  .mb-toast-leave-to {
    transform: none;
  }
}
</style>
