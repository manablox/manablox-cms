<script setup lang="ts">
import { Icon } from '@manablox/admin-sdk';
import { Handle, Position } from '@vue-flow/core';

/** The trigger on the canvas. Not a stored node; it gives the first edges a source. */
defineProps<{ data: { label: string; detail: string; icon: string }; selected: boolean }>();
</script>

<template>
  <div
    class="wf-node wf:w-72 wf:overflow-hidden wf:rounded-card wf:border-2 wf:bg-surface-0 wf:shadow-sm wf:dark:bg-surface-900"
    :class="selected ? 'wf:border-brand-500 wf:shadow-pop' : 'wf:border-brand-300 wf:dark:border-brand-700'"
  >
    <div class="wf:flex wf:items-center wf:gap-2.5 wf:bg-brand-500 wf:px-3 wf:py-2.5 wf:text-white">
      <span class="wf:flex wf:h-7 wf:w-7 wf:shrink-0 wf:items-center wf:justify-center wf:rounded-control wf:bg-white/20">
        <Icon :name="data.icon" class="mb-icon" />
      </span>
      <span class="wf:min-w-0 wf:flex-1">
        <span class="wf:block wf:truncate wf:text-sm wf:font-semibold wf:leading-tight">{{ data.label }}</span>
        <span class="wf:block wf:truncate wf:text-2xs wf:leading-tight wf:opacity-80">{{ data.detail }}</span>
      </span>
    </div>
    <div class="wf:border-t wf:border-surface-200 wf:py-1 wf:text-center wf:text-2xs wf:text-surface-500 wf:dark:border-surface-800">
      Starts here
    </div>
    <Handle id="out" type="source" :position="Position.Bottom" class="wf-port" style="left: 50%" />
  </div>
</template>
