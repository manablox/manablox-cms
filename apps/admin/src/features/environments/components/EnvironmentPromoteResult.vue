<script setup lang="ts">
import Dialog from '@manablox/admin-sdk/components/ui/Dialog.vue';
import type { PromoteOutcome } from '@manablox/admin-sdk/features/environments/model';

/** How a promote went, per table group. */
defineProps<{ outcome: PromoteOutcome }>();
const emit = defineEmits<{ close: [] }>();

const TONES = {
  ok: 'text-ok-700 dark:text-ok-500',
  warn: 'text-warn-800 dark:text-warn-200',
  danger: 'text-danger-700 dark:text-danger-300',
} as const;
</script>

<template>
  <Dialog :title="outcome.title" dismissable @close="emit('close')">
    <template #default="{ close }">
      <p class="text-sm" :class="TONES[outcome.tone]" role="status">{{ outcome.message }}</p>
      <ul class="mb-list mt-3 text-sm" data-testid="promote-groups">
        <li v-for="group in outcome.groups" :key="group.group" class="flex flex-wrap items-center gap-2 py-1">
          <span class="min-w-0 flex-1">{{ group.label }}</span>
          <span :class="group.badge.tone">{{ group.badge.text }}</span>
          <p v-if="group.error" class="mb-error w-full">{{ group.error }}</p>
        </li>
      </ul>
      <div class="mt-4 flex justify-end">
        <button type="button" class="mb-btn-primary" @click="close">Done</button>
      </div>
    </template>
  </Dialog>
</template>
