<script setup lang="ts">
import { Icon } from '@manablox/admin-sdk';
import { Handle, Position } from '@vue-flow/core';
import { computed } from 'vue';
import type { Tone } from '../../model';
import type { GraphNodeData } from './flowElements';

/** A canvas node: a coloured head, a config summary, and a labelled socket per port along the bottom. */
const props = defineProps<{
  data: GraphNodeData;
  selected: boolean;
}>();

/** Head colour per tone. */
const HEAD: Record<Tone, string> = {
  clay: 'wf:bg-brand-500/15 wf:text-brand-900 wf:dark:bg-brand-400/15 wf:dark:text-brand-100',
  iris: 'wf:bg-iris-500/15 wf:text-iris-700 wf:dark:bg-iris-500/15 wf:dark:text-iris-100',
  ochre: 'wf:bg-ochre-500/15 wf:text-ochre-700 wf:dark:bg-ochre-500/15 wf:dark:text-ochre-100',
  sand: 'wf:bg-warn-500/20 wf:text-warn-900 wf:dark:bg-warn-400/15 wf:dark:text-warn-100',
  plain: 'wf:bg-surface-200/70 wf:text-surface-800 wf:dark:bg-surface-800 wf:dark:text-surface-100',
};

const RUN_RING: Record<string, string> = {
  ok: 'wf:ring-2 wf:ring-ok-500',
  failed: 'wf:ring-2 wf:ring-danger-400',
  skipped: 'wf:ring-2 wf:ring-surface-300 wf:dark:ring-surface-600',
  stopped: 'wf:ring-2 wf:ring-warn-400',
  waiting: 'wf:ring-2 wf:ring-warn-400',
};

const RUN_ICON: Record<string, string> = {
  ok: 'ok',
  failed: 'fail',
  skipped: 'ban',
  stopped: 'ban',
  waiting: 'hourglass',
};

const PORT_TONE: Record<string, string> = {
  ok: 'wf-port-ok',
  error: 'wf-port-error',
  true: 'wf-port-ok',
  false: 'wf-port-warn',
  default: 'wf-port-warn',
};

/** Sockets spread evenly, each centred under its label. */
const placed = computed(() =>
  props.data.ports.map((port, index) => ({
    ...port,
    left: `${((index + 0.5) / props.data.ports.length) * 100}%`,
    tone: PORT_TONE[port.name] ?? 'wf-port',
  })),
);

const head = computed(() => HEAD[props.data.tone]);
</script>

<template>
  <div
    class="wf-node wf:w-72 wf:overflow-hidden wf:rounded-card wf:border wf:bg-surface-0 wf:shadow-sm wf:transition wf:dark:bg-surface-900"
    :class="[
      selected
        ? 'wf:border-brand-500 wf:shadow-pop wf:ring-2 wf:ring-brand-200 wf:dark:ring-brand-900'
        : 'wf:border-surface-300 wf:dark:border-surface-700',
      data.error ? 'wf:!border-danger-400' : '',
      data.runStatus ? RUN_RING[data.runStatus] : '',
      data.node.enabled ? '' : 'wf:opacity-60',
    ]"
  >
    <Handle id="in" type="target" :position="Position.Top" class="wf-port" />

    <div class="wf:flex wf:items-center wf:gap-2.5 wf:px-3 wf:py-2" :class="head">
      <span class="wf:flex wf:h-7 wf:w-7 wf:shrink-0 wf:items-center wf:justify-center wf:rounded-control wf:bg-surface-0/70 wf:dark:bg-surface-950/40">
        <Icon :name="data.icon" class="mb-icon" />
      </span>
      <span class="wf:min-w-0 wf:flex-1">
        <span class="wf:block wf:truncate wf:text-sm wf:font-semibold wf:leading-tight">{{ data.label }}</span>
        <span class="wf:block wf:truncate wf:font-mono wf:text-2xs wf:leading-tight wf:opacity-70">{{ data.node.key }}</span>
      </span>
      <Icon
        v-if="data.runStatus"
        :name="RUN_ICON[data.runStatus] ?? 'ok'"
        class="mb-icon wf:shrink-0 wf:opacity-80"
      />
      <Icon v-else-if="!data.node.enabled" name="power" class="mb-icon-sm wf:shrink-0 wf:opacity-70" />
      <Icon
        v-else-if="data.node.join === 'all'"
        name="filter"
        class="mb-icon-sm wf:shrink-0 wf:opacity-70"
      />
    </div>

    <div class="wf:px-3 wf:py-2">
      <p v-if="data.error" class="wf:line-clamp-2 wf:text-xs wf:text-danger-600 wf:dark:text-danger-400">
        {{ data.error }}
      </p>
      <p
        v-else-if="data.unavailable"
        class="wf:line-clamp-2 wf:text-xs wf:text-warn-700 wf:dark:text-warn-300"
      >
        {{ data.unavailable }}
      </p>
      <p
        v-else-if="data.subtitle"
        class="wf:line-clamp-2 wf:break-all mb-meta"
      >
        {{ data.subtitle }}
      </p>
      <p v-else class="wf:text-xs wf:text-surface-400">Not set up yet.</p>
    </div>

    <div v-if="placed.length" class="wf:flex wf:border-t wf:border-surface-200 wf:text-2xs wf:dark:border-surface-800">
      <span
        v-for="port in placed"
        :key="port.name"
        class="wf:min-w-0 wf:flex-1 wf:truncate wf:px-1 wf:py-1 wf:text-center wf:text-surface-500"
        :title="port.label"
      >
        {{ port.label }}
      </span>
    </div>

    <Handle
      v-for="port in placed"
      :id="port.name"
      :key="port.name"
      type="source"
      :position="Position.Bottom"
      :style="{ left: port.left }"
      :class="port.tone"
    />
  </div>
</template>
