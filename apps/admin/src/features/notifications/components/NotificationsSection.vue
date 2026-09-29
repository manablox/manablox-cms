<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import AsyncList from '@manablox/admin-sdk/components/ui/AsyncList.vue';
import IconButton from '@manablox/admin-sdk/components/ui/IconButton.vue';
import Panel from '@manablox/admin-sdk/components/ui/Panel.vue';
import Switch from '@manablox/admin-sdk/components/ui/Switch.vue';
import { formatDateTime } from '@manablox/admin-sdk/lib/format';
import { invalidate } from '@manablox/admin-sdk/lib/invalidate';
import { messageFor } from '@manablox/admin-sdk/lib/messages';
import { runWrite } from '@manablox/admin-sdk/lib/write';
import { computed, onMounted, ref } from 'vue';
import { currentSubscription, pushSupported, subscribe, unsubscribe } from '../push';
import { pushSubscriptions, useNotificationCatalog, usePushSubscriptions } from '../queries';

/** Settings -> Notifications: push subscriptions, one per browser. */
const { data: catalog } = useNotificationCatalog();
const { data: subscriptions, isPending, error, refetch } = usePushSubscriptions();

const supported = pushSupported();
const endpoint = ref<string | null>(null);
const busy = ref(false);

onMounted(async () => {
  endpoint.value = (await currentSubscription())?.endpoint ?? null;
});

const thisBrowserOn = computed(
  () =>
    endpoint.value !== null &&
    (subscriptions.value ?? []).some((row) => row.endpoint === endpoint.value),
);
const permissionDenied = computed(() => supported && Notification.permission === 'denied');

/** Browser push errors are plain `Error`s with their own sentence. */
const describePushError = (error: unknown) =>
  error instanceof Error && !('data' in error) ? error.message : messageFor(error);

function toggle() {
  const publicKey = catalog.value?.pushPublicKey;
  if (!publicKey) return;
  const turningOff = thisBrowserOn.value;
  return runWrite(
    async () => {
      if (turningOff) {
        await unsubscribe();
        endpoint.value = null;
      } else {
        const subscription = await subscribe(publicKey);
        endpoint.value = subscription.endpoint;
      }
      invalidate.pushSubscriptions();
    },
    {
      success: turningOff
        ? 'This browser will not be notified any more'
        : 'This browser will be notified',
      busy,
      describe: describePushError,
    },
  );
}

function forget(row: { endpoint: string }) {
  return runWrite(async () => {
    await pushSubscriptions.unsubscribe(row.endpoint);
    if (row.endpoint === endpoint.value) {
      await unsubscribe().catch(() => undefined);
      endpoint.value = null;
    }
  });
}

/** A short name for a browser, from its user agent. */
function describe(userAgent: string | null): string {
  if (!userAgent) return 'A browser';
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Chrome\//.test(userAgent)
          ? 'Chrome'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : 'A browser';
  const os = /Android/.test(userAgent)
    ? 'Android'
    : /iPhone|iPad/.test(userAgent)
      ? 'iOS'
      : /Mac OS/.test(userAgent)
        ? 'macOS'
        : /Windows/.test(userAgent)
          ? 'Windows'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : '';
  return os ? `${browser} on ${os}` : browser;
}
</script>

<template>
  <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
    <section class="mb-card space-y-4">
      <div class="flex items-center gap-3">
        <span class="mb-tile-ochre flex h-10 w-10 items-center justify-center rounded-card">
          <Icon name="bell-ring" class="mb-icon-lg" />
        </span>
        <div>
          <h2 class="text-base font-bold">This browser</h2>
          <p class="mb-meta">Notifications, and workflows with a push step, can reach you here, even when the admin is closed.</p>
        </div>
      </div>

      <p v-if="catalog && !catalog.available.push" class="mb-callout text-xs">
        Push is not configured on this instance. An administrator sets <span class="font-mono">PUSH_VAPID_PUBLIC_KEY</span> and <span class="font-mono">PUSH_VAPID_PRIVATE_KEY</span> - <span class="font-mono">manablox push-keys</span> (in a created project <span class="font-mono">pnpm push-keys</span>) makes a pair.
      </p>
      <p v-else-if="!supported" class="mb-callout text-xs">
        This browser cannot receive push notifications here. It needs a secure (https) origin and a browser that supports Web Push.
      </p>
      <p v-else-if="permissionDenied" class="mb-callout text-xs">
        Notifications are blocked for this site in the browser's settings. Allow them there, then come back.
      </p>

      <Switch
        :model-value="thisBrowserOn"
        :disabled="busy || !supported || !catalog?.available.push || permissionDenied"
        @update:model-value="toggle"
      >
        <span class="text-sm font-medium">{{ busy ? 'One moment...' : thisBrowserOn ? 'Notifications are on here' : 'Turn notifications on here' }}</span>
      </Switch>
    </section>

    <Panel title="Browsers that get notified" size="sm" :count="subscriptions?.length ?? 0">
      <AsyncList
        :pending="isPending"
        :error="error"
        :retry="refetch"
        :items="subscriptions"
        item-class="flex items-center gap-3 py-2"
      >
        <template #empty><p class="text-sm text-surface-500">None yet.</p></template>
        <template #item="{ item: row }">
          <Icon name="monitor" class="mb-icon shrink-0 text-surface-400" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium">
              {{ describe(row.userAgent) }}
              <span v-if="row.endpoint === endpoint" class="mb-badge-brand ml-1 text-2xs">this one</span>
            </span>
            <span class="block text-2xs text-surface-500">
              Added {{ formatDateTime(row.createdAt) }}<template v-if="row.lastUsedAt"> - last notified {{ formatDateTime(row.lastUsedAt) }}</template>
            </span>
          </span>
          <IconButton icon="trash" label="Remove this browser" danger @click="forget(row)" />
        </template>
      </AsyncList>
    </Panel>
  </div>
</template>
