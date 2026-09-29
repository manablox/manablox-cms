<script setup lang="ts">
import type { FeatureKey } from '@manablox/core';
import { computed } from 'vue';
import type { FeatureState } from '../../lib/features';
import { useSessionStore } from '../../stores/session';
import { useSpaceStore } from '../../stores/space';
import FeatureLock from './FeatureLock.vue';

/**
 * The slot while `feature` is on in the current space; nothing when it is hidden; a lock when
 * it is locked (`#locked` replaces the lock, e.g. with a disabled control beside one).
 */
const props = withDefaults(
  defineProps<{
    feature: FeatureKey;
    /** The locked trigger's text; icon only without it. */
    label?: string | undefined;
    triggerClass?: string | undefined;
    align?: 'start' | 'center' | 'end';
    /** The instance's value instead of the current space's, e.g. for creating a space. */
    instance?: boolean;
  }>(),
  { align: 'start', instance: false },
);
defineSlots<{
  default(): unknown;
  locked?(props: { state: FeatureState }): unknown;
}>();

const session = useSessionStore();
const spaces = useSpaceStore();
const state = computed(() =>
  session.feature(props.feature, props.instance ? null : spaces.currentId),
);
</script>

<template>
  <slot v-if="state.enabled" />
  <template v-else-if="state.locked">
    <slot name="locked" :state="state">
      <FeatureLock :feature="feature" :state="state" :label="label" :trigger-class="triggerClass" :align="align" />
    </slot>
  </template>
</template>
