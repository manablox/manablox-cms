<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import EmptyState from '@manablox/admin-sdk/components/ui/EmptyState.vue';
import { type FeatureState, featureLabel } from '@manablox/admin-sdk/lib/features';
import type { FeatureKey } from '@manablox/core';
import { computed } from 'vue';

/** What stands in place of a page whose feature is off: the message and link, or neutral text when hidden. */
const props = defineProps<{ feature: FeatureKey; state: FeatureState }>();

const title = computed(() =>
  props.state.hidden ? 'This page is not available' : `${featureLabel(props.feature)} is locked`,
);
const description = computed(() =>
  props.state.hidden
    ? 'It is switched off on this instance.'
    : (props.state.message ?? 'It is not available here at the moment.'),
);
</script>

<template>
  <EmptyState class="mt-8" :icon="state.hidden ? 'ban' : 'lock'" :title="title" :description="description">
    <a v-if="!state.hidden && state.link" :href="state.link" target="_blank" rel="noopener" class="mb-btn-primary">
      See how to unlock <Icon name="external" class="mb-icon-sm" />
    </a>
  </EmptyState>
</template>
