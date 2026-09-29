<script setup lang="ts">
import { Icon, Select } from '@manablox/admin-sdk';
import { computed, ref } from 'vue';
import type { WebhookView } from '../../sdk';
import WebhookDialog from './WebhookDialog.vue';

/** Picks or creates the incoming endpoint for a webhook trigger; creating refreshes the catalogue. */
const props = defineProps<{
  modelValue: string | null;
  /** The space's incoming endpoints. */
  webhooks: WebhookView[];
  spaceId: string | null;
  readOnly?: boolean | undefined;
  /** The select's id, for a label. */
  id?: string | undefined;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>();

const adding = ref(false);

const options = computed(() =>
  props.webhooks.map((hook) => ({
    value: hook.id,
    label: hook.name,
    hint: hook.enabled ? (hook.endpoint ?? '') : 'Switched off - calls to it are refused',
  })),
);
</script>

<template>
  <div>
    <div v-if="webhooks.length" class="wh:flex wh:gap-2">
      <Select
        :id="id"
        :model-value="modelValue"
        :options="options"
        class="wh:flex-1"
        :disabled="readOnly"
        placeholder="Pick an endpoint"
        @update:model-value="emit('update:modelValue', $event)"
      />
      <button v-if="!readOnly" type="button" class="mb-btn-ghost wh:shrink-0" @click="adding = true">
        <Icon name="plus" /> Add
      </button>
    </div>

    <!-- No endpoints yet. -->
    <div
      v-else
      class="wh:rounded-card wh:border wh:border-dashed wh:border-surface-300 wh:p-4 wh:text-center wh:dark:border-surface-700"
    >
      <p class="wh:text-sm wh:font-medium">No incoming webhooks in this space yet</p>
      <p class="mb-hint">
        The endpoint holds the URL and the secret, so several workflows can share one.
      </p>
      <button v-if="!readOnly" type="button" class="mb-btn-primary wh:mt-2" @click="adding = true">
        <Icon name="plus" /> Add a webhook
      </button>
    </div>

    <WebhookDialog
      v-if="adding && spaceId"
      :space-id="spaceId"
      :webhook="null"
      direction="incoming"
      @close="adding = false"
      @saved="emit('update:modelValue', $event.id)"
    />
  </div>
</template>
