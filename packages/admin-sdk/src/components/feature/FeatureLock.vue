<script setup lang="ts">
import type { FeatureKey } from '@manablox/core';
import { computed, ref } from 'vue';
import { type FeatureState, featureLabel } from '../../lib/features';
import { useSessionStore } from '../../stores/session';
import { useSpaceStore } from '../../stores/space';
import Icon from '../Icon.vue';
import Popover from '../ui/Popover.vue';

/** A locked control: a lock (with `label`, the control's text) opening the message and link. */
const props = withDefaults(
  defineProps<{
    feature: FeatureKey;
    /** The control's text; icon only without it. */
    label?: string | undefined;
    /** The trigger's button classes, to keep the control's look. */
    triggerClass?: string | undefined;
    /** Given by `FeatureGate`; read from the current space otherwise. */
    state?: FeatureState | undefined;
    align?: 'start' | 'center' | 'end';
    /** The instance's value instead of the current space's, e.g. for creating a space. */
    instance?: boolean;
  }>(),
  { align: 'start', instance: false },
);

const session = useSessionStore();
const spaces = useSpaceStore();
const current = computed(
  () => props.state ?? session.feature(props.feature, props.instance ? null : spaces.currentId),
);
const open = ref(false);
const name = computed(() => featureLabel(props.feature));
</script>

<template>
  <Popover v-model:open="open" :align="align" class="w-72 p-3">
    <template #trigger>
      <button
        type="button"
        :class="triggerClass ?? (label ? 'mb-btn-ghost mb-btn-sm' : 'mb-btn-ghost mb-btn-icon mb-btn-sm')"
        :aria-label="`${label ?? name} - locked`"
        :title="label ? undefined : `${name} is locked`"
        data-feature-lock
      >
        <Icon name="lock" class="mb-icon-sm" />
        <template v-if="label">{{ label }}</template>
      </button>
    </template>
    <p class="text-sm font-semibold">{{ name }} is locked</p>
    <p class="mt-1 text-sm text-surface-600 dark:text-surface-400">
      {{ current.message ?? 'It is not available here at the moment.' }}
    </p>
    <a
      v-if="current.link"
      :href="current.link"
      target="_blank"
      rel="noopener"
      class="mb-btn-primary mb-btn-sm mt-3"
    >
      See how to unlock <Icon name="external" class="mb-icon-sm" />
    </a>
  </Popover>
</template>
