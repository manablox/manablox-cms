<script setup lang="ts">
import {
  AsyncList,
  Icon,
  JsonBlock,
  messageForKey,
  plural,
  relativeTime,
  requireSpace,
  runWrite,
} from '@manablox/admin-sdk';
import { computed, ref } from 'vue';
import { webhooks as actions, DELIVERY_PAGE_SIZE, useDeliveries, type Webhook } from '../queries';

/** An endpoint's call log, refused calls included with their reason. */
const props = defineProps<{ webhook: Webhook }>();

const { data, isPending, error, refetch, page, total } = useDeliveries(() => props.webhook.id);
const deliveries = computed(() => data.value?.items);
const open = ref<string | null>(null);
const busy = ref<string | null>(null);

const outgoing = computed(() => props.webhook.direction === 'outgoing');

const ok = (status: number | null, error: string | null) =>
  !error && status !== null && status < 400;

/** Refusals are logged as error keys. */
const reason = (error: string | null) => (error ? messageForKey(error) : null);

async function retry(deliveryId: string) {
  busy.value = deliveryId;
  await runWrite(() => actions.retry(requireSpace(), props.webhook.id, deliveryId), {
    success: (sent) =>
      sent.error ? `Sent again: ${sent.error}` : `Sent again: HTTP ${sent.status}`,
  });
  busy.value = null;
}
</script>

<template>
  <AsyncList
    v-model:page="page"
    :total="total"
    :page-size="DELIVERY_PAGE_SIZE"
    previous-label="Newer calls"
    next-label="Older calls"
    :pending="isPending"
    :error="error"
    :retry="refetch"
    :items="deliveries"
    empty-icon="clock"
    empty-title="Nothing yet"
    :empty-description="
      outgoing
        ? 'No call has gone out. Send a test to prove the endpoint.'
        : 'Nobody has called this URL yet.'
    "
    item-class="wh:py-2"
  >
    <template #item="{ item: delivery }">
      <div class="wh:flex wh:items-center wh:gap-3">
        <Icon
          :name="ok(delivery.status, delivery.error) ? 'ok' : 'fail'"
          class="mb-icon wh:shrink-0"
          :class="ok(delivery.status, delivery.error) ? 'wh:text-ok-500' : 'wh:text-danger-500'"
        />
        <button
          type="button"
          class="wh:min-w-0 wh:flex-1 wh:text-left"
          :aria-expanded="open === delivery.id"
          @click="open = open === delivery.id ? null : delivery.id"
        >
          <span class="wh:block wh:truncate wh:text-sm wh:font-medium">
            {{ delivery.event }}
            <span v-if="delivery.attempt > 1" class="mb-badge wh:ml-1">
              attempt {{ delivery.attempt }}
            </span>
          </span>
          <span class="wh:block wh:truncate mb-meta">
            {{ relativeTime(delivery.createdAt) }}
            <template v-if="delivery.status !== null"> - HTTP {{ delivery.status }}</template>
            <template v-if="delivery.ms !== null"> - {{ delivery.ms }} ms</template>
            <template v-if="delivery.runIds.length">
              - started {{ plural(delivery.runIds.length, 'workflow') }}
            </template>
            <template v-else-if="delivery.direction === 'incoming' && !delivery.error">
              - no workflow is waiting on this endpoint
            </template>
          </span>
        </button>
        <button
          v-if="outgoing"
          type="button"
          class="mb-btn-ghost wh:shrink-0"
          :disabled="busy === delivery.id"
          @click="retry(delivery.id)"
        >
          {{ busy === delivery.id ? 'Sending...' : 'Send again' }}
        </button>
      </div>

      <p v-if="delivery.error" class="wh:mt-1 wh:pl-7 wh:text-xs wh:text-danger-500">
        {{ reason(delivery.error) }}
      </p>

      <div v-if="open === delivery.id" class="wh:mt-2 wh:space-y-2 wh:pl-7">
        <div>
          <span class="mb-label">{{ outgoing ? 'Sent' : 'Received' }}</span>
          <JsonBlock :value="delivery.payload" :label="outgoing ? 'the sent body' : 'the received body'" max-height="wh:max-h-64" />
        </div>
        <div v-if="Object.keys(delivery.headers).length">
          <span class="mb-label">Headers</span>
          <JsonBlock :value="delivery.headers" label="the headers" max-height="wh:max-h-40" />
          <p class="wh:mt-1 mb-meta">
            The headers that carry the secret itself are not kept.
          </p>
        </div>
      </div>
    </template>
  </AsyncList>
</template>
