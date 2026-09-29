<script setup lang="ts">
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import { onBeforeUnmount, ref, useTemplateRef } from 'vue';
import { focusFirstFieldSoon } from '../../lib/focus';
import { suspendShortcuts } from '../../lib/shortcuts';
import Icon from '../Icon.vue';

/**
 * Modal shown while mounted (`v-if` it in); emits `close`. Suspends page shortcuts and
 * focuses the body's first field on open.
 */
withDefaults(
  defineProps<{
    title: string;
    /** Tailwind max-width class. */
    width?: string | undefined;
    /** Close on outside press; off by default so forms are not lost to stray clicks. */
    dismissable?: boolean;
  }>(),
  { dismissable: false },
);
const emit = defineEmits<{ close: [] }>();

// Close locally first and emit after the exit animation (timer as fallback), so `v-if` does not cut it short.
const open = ref(true);
let fallback: ReturnType<typeof setTimeout> | null = null;
const resumeShortcuts = suspendShortcuts();

function requestClose() {
  if (!open.value) return;
  open.value = false;
  fallback = setTimeout(finish, 400);
}

function finish() {
  if (fallback) {
    clearTimeout(fallback);
    fallback = null;
  }
  emit('close');
}

function onPanelAnimationEnd() {
  if (!open.value) finish();
}

const body = useTemplateRef<HTMLElement>('body');

function onOpenAutoFocus(event: Event) {
  // Keep reka-ui's default while the body's inputs are still loading.
  if (body.value && focusFirstFieldSoon(body.value)) event.preventDefault();
}

defineExpose({ requestClose });

onBeforeUnmount(() => {
  if (fallback) clearTimeout(fallback);
  resumeShortcuts();
});
</script>

<template>
  <DialogRoot :open="open" @update:open="(next) => !next && requestClose()">
    <DialogPortal>
      <DialogOverlay class="mb-backdrop mb-anim-overlay mb-z-overlay fixed inset-0" />
      <!-- The animation sits on `DialogContent` itself: reka-ui unmounts after its own animation. -->
      <div class="mb-z-overlay pointer-events-none fixed inset-0 flex items-end justify-center p-2 sm:items-center sm:p-6">
        <!-- Bound (not plain) `aria-describedby` so Vue omits it instead of writing "undefined". -->
        <DialogContent
          class="mb-anim-modal-panel mb-surface-card pointer-events-auto flex max-h-[calc(100dvh-1rem)] w-full flex-col rounded-card border border-surface-200 shadow-modal outline-none sm:max-h-[85vh] dark:border-surface-800"
          :class="width ?? 'max-w-lg'"
          :aria-describedby="undefined"
          @interact-outside="dismissable ? undefined : $event.preventDefault()"
          @pointer-down-outside="dismissable ? undefined : $event.preventDefault()"
          @focus-outside.prevent
          @open-auto-focus="onOpenAutoFocus"
          @animationend="onPanelAnimationEnd"
        >
          <div class="flex items-center gap-3 px-4 pt-3 pb-1.5">
            <DialogTitle as="h2" class="flex-1 font-display text-lg font-bold">{{ title }}</DialogTitle>
            <button class="mb-btn-ghost mb-btn-icon mb-btn-sm -mr-1" aria-label="Close" @click="requestClose">
              <Icon name="x" />
            </button>
          </div>

          <!-- Top padding keeps the first row's focus ring from being clipped. -->
          <div ref="body" class="flex-1 overflow-y-auto px-4 pt-1 pb-3"><slot :close="requestClose" /></div>

          <!-- Cancel buttons should call `close` so the exit animation runs. -->
          <div v-if="$slots.footer" class="flex justify-end gap-2 border-t border-surface-200 px-4 py-2.5 dark:border-surface-800">
            <slot name="footer" :close="requestClose" />
          </div>
        </DialogContent>
      </div>
    </DialogPortal>
  </DialogRoot>
</template>
