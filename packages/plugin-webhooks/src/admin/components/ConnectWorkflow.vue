<script setup lang="ts">
import { Icon, useSpaceStore } from '@manablox/admin-sdk';
import { ref } from 'vue';
import type { WebhookView } from '../../sdk';
import { useWorkflowsApi } from '../useWorkflowsApi';

/** Starts a new workflow on an incoming endpoint, with the webhook trigger preselected. */
defineProps<{ webhook: Pick<WebhookView, 'id' | 'name'> }>();

const workflows = useWorkflowsApi();
const spaces = useSpaceStore();
const connecting = ref(false);
</script>

<template>
  <template v-if="workflows">
    <button type="button" class="mb-btn-ghost" :title="`Start a workflow on ${webhook.name}`" @click="connecting = true">
      <Icon name="workflow" /> Connect to workflow
    </button>
    <component
      :is="workflows.CreateDialog"
      v-if="connecting && spaces.currentId"
      :space-id="spaces.currentId"
      kind="webhook"
      :preset="webhook.id"
      @close="connecting = false"
    />
  </template>
</template>
