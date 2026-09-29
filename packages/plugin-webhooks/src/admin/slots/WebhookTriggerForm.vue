<script setup lang="ts">
import { CopyField, FormField } from '@manablox/admin-sdk';
import type { WorkflowTriggerFormProps } from '@manablox/plugin-workflows/admin-slots';
import { computed } from 'vue';
import IncomingWebhookPicker from '../components/IncomingWebhookPicker.vue';
import { PAYLOAD_PLACEHOLDER } from '../model';
import { type WebhookTriggerValue, webhookOf, webhooksOf } from '../model/trigger';

/**
 * The incoming endpoint a trigger starts on or an abort trigger stops on; in the new workflow
 * dialog, the one to start on. Which calls count is the workflows card's filter.
 */
const props = defineProps<WorkflowTriggerFormProps>();

const trigger = computed(() => props.trigger as WebhookTriggerValue);
const hooks = computed(() => webhooksOf(props.catalog));
const hook = computed(() => webhookOf(props.catalog, trigger.value.webhookId)[0] ?? null);

const pick = (webhookId: string | null) => props.update({ ...props.trigger, webhookId });
</script>

<template>
  <FormField label="Incoming webhook" :error="errorFor(['webhookId'])">
    <template #default="{ id }">
      <IncomingWebhookPicker
        :id="id"
        :model-value="trigger.webhookId"
        :webhooks="hooks"
        :space-id="spaceId"
        :read-only="readOnly"
        @update:model-value="pick"
      />
    </template>
    <template v-if="mode === 'create' && hooks.length" #hint>
      <p class="mb-hint">Several workflows may start on the same endpoint; each can filter on what arrived.</p>
    </template>
  </FormField>

  <p v-if="mode === 'abort'" class="mb-hint">
    A call to this endpoint aborts runs. It can also start workflows; the aborts happen first.
  </p>

  <div v-else-if="mode === 'trigger' && hook" class="wh:rounded-card wh:border wh:border-surface-200 wh:p-3 wh:dark:border-surface-800">
    <CopyField v-if="hook.endpoint" :value="hook.endpoint" label="The URL to hand out" url />
    <p v-if="!hook.enabled" class="mb-error">
      This endpoint is switched off, so calls to it are refused and this workflow never
      starts.
    </p>
    <p class="mb-hint">
      What arrives is available to every node as
      <span class="wh:font-mono">{{ PAYLOAD_PLACEHOLDER }}</span>, with the query string
      under <span class="wh:font-mono">payload.query</span> and the request headers under
      <span class="wh:font-mono">headers</span>.
    </p>
  </div>
</template>
