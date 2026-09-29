<script setup lang="ts">
import {
  AsyncList,
  COPIED_URL,
  confirmAndRun,
  copyText,
  Icon,
  IconButton,
  NewButton,
  PageHeader,
  plural,
  relativeTime,
  requireSpace,
  runWrite,
  SectionIntro,
  StatusBadge,
  Switch,
  Tabs,
  toast,
  useCan,
  useSpaceStore,
} from '@manablox/admin-sdk';
import { computed, ref } from 'vue';
import {
  WEBHOOK_AUTH_MODE_LABELS,
  WEBHOOK_DIRECTION_LABELS,
  type WebhookDirection,
} from '../../sdk';
import ConnectWorkflow from '../components/ConnectWorkflow.vue';
import DeliveryList from '../components/DeliveryList.vue';
import WebhookDialog from '../components/WebhookDialog.vue';
import { webhooks as actions, useWebhookPage, WEBHOOK_PAGE_SIZE, type Webhook } from '../queries';
import { useWorkflowsApi } from '../useWorkflowsApi';

/** Incoming and outgoing webhooks, one tab each. */
const spaces = useSpaceStore();
const direction = ref<WebhookDirection>('incoming');
const { data, isPending, error, refetch, page, total } = useWebhookPage(direction);
const canWrite = useCan('webhooks:write');
/** Incoming calls start workflows only with that plugin loaded. */
const workflows = useWorkflowsApi();
const canConnect = useCan('workflows:write');

const editing = ref<Webhook | null>(null);
const creating = ref(false);
const openLog = ref<string | null>(null);
const busy = ref<string | null>(null);

const TABS = [
  { id: 'incoming' as const, label: 'Incoming', icon: 'branch' },
  { id: 'outgoing' as const, label: 'Outgoing', icon: 'external' },
];

const shown = computed(() => data.value?.items);
const incoming = computed(() => direction.value === 'incoming');

function toggle(webhook: Webhook, enabled: boolean) {
  return runWrite(() => actions.setEnabled(requireSpace(), webhook.id, enabled), {
    success: `${webhook.name} is ${enabled ? 'on' : 'off'}`,
  });
}

const copy = (text: string) => copyText(text, COPIED_URL);

async function sendTest(webhook: Webhook) {
  busy.value = webhook.id;
  // A refused call is an answer, not a failure: it is toasted from the result.
  await runWrite(async () => {
    const sent = await actions.test(requireSpace(), webhook.id);
    openLog.value = webhook.id;
    if (sent.error) toast.error(`The call failed: ${sent.error}`);
    else toast.success(`The endpoint answered HTTP ${sent.status}`);
  });
  busy.value = null;
}

function remove(webhook: Webhook) {
  return confirmAndRun(
    {
      title: `Delete "${webhook.name}"?`,
      message:
        webhook.direction === 'incoming'
          ? 'Whoever calls the URL will get a 404, and any workflow triggered by it stops running.'
          : 'Nothing will be sent there any more. Its delivery log goes with it.',
      confirmLabel: 'Delete webhook',
      danger: true,
    },
    () => actions.remove(requireSpace(), webhook.id),
    { success: `Deleted "${webhook.name}"` },
  );
}
</script>

<template>
  <div class="mb-page-narrow">
    <PageHeader
      title="Webhooks"
      description="The calls this space receives and the calls it makes. An incoming one starts the workflows pointed at it; an outgoing one tells another system that content changed."
    >
      <!-- New webhooks take the tab's direction. -->
      <NewButton :label="`New ${incoming ? 'incoming' : 'outgoing'} webhook`" :enabled="canWrite" @click="creating = true" />
    </PageHeader>

    <Tabs v-model="direction" :tabs="TABS" aria-label="Webhook direction" />

    <section class="mb-card wh:mt-4 wh:space-y-3">
      <SectionIntro
        icon="webhook"
        tile="iris"
        :title="WEBHOOK_DIRECTION_LABELS[direction].label"
        :count="total"
        :blurb="WEBHOOK_DIRECTION_LABELS[direction].description"
      />

      <template v-if="incoming">
        <p class="mb-hint">
          Calls go to <code class="wh:font-mono">/plugins/webhooks/in/...</code>.
        </p>
        <p v-if="!workflows" class="mb-callout wh:text-xs">
          Calls are received and logged, but nothing runs them unless a plugin listens, such as
          workflows.
        </p>
      </template>

      <AsyncList
        :pending="isPending"
        :error="error"
        :retry="refetch"
        :items="shown"
        empty-icon="webhook"
        :empty-title="incoming ? 'No incoming webhooks' : 'No outgoing webhooks'"
        :empty-description="
          canWrite
            ? incoming
              ? workflows
                ? 'Create one to get a URL another system can call, then point a workflow at it.'
                : 'Create one to get a URL another system can call.'
              : 'Create one to have this space call out when content changes.'
            : 'Someone with webhook rights can create one.'
        "
        item-class="wh:py-3"
        v-model:page="page"
        :total="total"
        :page-size="WEBHOOK_PAGE_SIZE"
      >
        <template v-if="canWrite" #empty-actions>
          <button class="mb-btn-primary" @click="creating = true">Create webhook</button>
        </template>
        <template #item="{ item: hook }">
          <div class="wh:flex wh:flex-wrap wh:items-start wh:gap-3">
            <div class="wh:min-w-0 wh:flex-1">
              <div class="wh:flex wh:flex-wrap wh:items-center wh:gap-2">
                <span class="wh:truncate wh:text-sm wh:font-medium">{{ hook.name }}</span>
                <span class="mb-badge">
                  {{ WEBHOOK_AUTH_MODE_LABELS[hook.auth.mode].label }}
                </span>
                <template v-if="incoming && workflows">
                  <span v-if="hook.listeners === 0" class="mb-badge-warn mb-badge">no workflow</span>
                  <span v-else class="mb-badge">{{ plural(hook.listeners, 'workflow') }}</span>
                </template>
                <StatusBadge
                  v-if="hook.source === 'code'"
                  status="code"
                  :title="`Declared by ${hook.sourceRef ?? 'the config'}. Edit it there.`"
                />
              </div>

              <p v-if="hook.description" class="wh:truncate mb-meta">
                {{ hook.description }}
              </p>

              <!-- The address; the button hugs the URL, not the column. -->
              <div class="wh:mt-1 wh:flex wh:items-center wh:gap-1">
                <code
                  class="wh:min-w-0 wh:truncate wh:font-mono wh:text-xs"
                  :class="hook.endpoint ? 'wh:text-surface-700 wh:dark:text-surface-300' : 'wh:text-surface-500'"
                >
                  {{ hook.endpoint ?? hook.url }}
                </code>
                <IconButton
                  v-if="hook.endpoint"
                  icon="copy"
                  :label="`Copy the URL of ${hook.name}`"
                  class="wh:shrink-0"
                  @click="copy(hook.endpoint)"
                />
              </div>

              <p class="wh:mt-1 mb-meta">
                <template v-if="!incoming">
                  {{ hook.events.length ? hook.events.join(', ') : 'Every content event' }} -
                </template>
                <template v-if="hook.lastUsedAt">
                  last {{ incoming ? 'called' : 'sent' }} {{ relativeTime(hook.lastUsedAt) }}
                </template>
                <template v-else>never used yet</template>
              </p>
            </div>

            <div class="wh:flex wh:max-w-full wh:flex-wrap wh:items-center wh:gap-2">
              <Switch
                :model-value="hook.enabled"
                compact
                :disabled="!canWrite"
                :aria-label="`Switch ${hook.name} on or off`"
                @update:model-value="toggle(hook, $event)"
              />
              <button
                type="button"
                class="mb-btn-ghost"
                @click="openLog = openLog === hook.id ? null : hook.id"
              >
                Log
              </button>
              <ConnectWorkflow v-if="incoming && canConnect" :webhook="hook" />
              <button
                v-if="canWrite && !incoming"
                type="button"
                class="mb-btn-ghost"
                :disabled="busy === hook.id"
                @click="sendTest(hook)"
              >
                {{ busy === hook.id ? 'Sending...' : 'Send test' }}
              </button>
              <button
                v-if="canWrite && hook.source !== 'code'"
                type="button"
                class="mb-btn-ghost"
                @click="editing = hook"
              >
                Edit
              </button>
              <button
                v-if="canWrite && hook.source !== 'code'"
                type="button"
                class="mb-btn-ghost-danger"
                :aria-label="`Delete ${hook.name}`"
                @click="remove(hook)"
              >
                <Icon name="trash" /> Delete
              </button>
            </div>
          </div>

          <div v-if="openLog === hook.id" class="wh:mt-3 wh:rounded-card wh:bg-surface-50 wh:p-3 wh:dark:bg-surface-900/50">
            <DeliveryList :webhook="hook" />
          </div>
        </template>
      </AsyncList>
    </section>

    <WebhookDialog
      v-if="creating && spaces.currentId"
      :webhook="null"
      :space-id="spaces.currentId"
      :direction="direction"
      @close="creating = false"
    />
    <WebhookDialog
      v-if="editing && spaces.currentId"
      :webhook="editing"
      :space-id="spaces.currentId"
      :direction="editing.direction"
      @close="editing = null"
    />
  </div>
</template>
