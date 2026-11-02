<script setup lang="ts">
import { Icon } from '@manablox/admin-sdk';
import type { AiCapability } from '../../sdk';

/** A provider's collapsed row: name, capabilities and status. */
defineProps<{
  label: string;
  detail: string;
  /** Monospace detail, for identifiers like `custom:slug`. */
  mono?: boolean;
  icon: string;
  capabilities: readonly AiCapability[];
  status: { label: string; on: boolean };
}>();

const CAPABILITY_LABELS: Record<AiCapability, string> = {
  text: 'Text',
  image: 'Images',
  video: 'Video',
};
</script>

<template>
  <span class="mb-surface-inset ai:flex ai:size-9 ai:shrink-0 ai:items-center ai:justify-center ai:rounded-card ai:text-surface-500">
    <Icon :name="icon" class="mb-icon" />
  </span>
  <span class="ai:min-w-0 ai:flex-1">
    <span class="ai:block ai:truncate ai:text-sm ai:font-semibold">{{ label }}</span>
    <span :class="['ai:block ai:truncate ai:text-xs ai:font-normal ai:text-surface-500', mono && 'ai:font-mono']">{{ detail }}</span>
  </span>
  <span v-if="capabilities.length" class="ai:hidden ai:shrink-0 ai:gap-1 ai:sm:flex">
    <span v-for="capability in capabilities" :key="capability" class="mb-badge">
      {{ CAPABILITY_LABELS[capability] }}
    </span>
  </span>
  <span :class="['ai:shrink-0', status.on ? 'mb-badge-ok' : 'mb-badge']">{{ status.label }}</span>
</template>
