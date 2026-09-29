<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import AsyncList from '@manablox/admin-sdk/components/ui/AsyncList.vue';
import SaveButton from '@manablox/admin-sdk/components/ui/SaveButton.vue';
import Switch from '@manablox/admin-sdk/components/ui/Switch.vue';
import { useDraftForm } from '@manablox/admin-sdk/composables/useDraftForm';
import { plainClone } from '@manablox/admin-sdk/lib/clone';
import { toast } from '@manablox/admin-sdk/lib/toast';
import { computed, type Ref, watch } from 'vue';
import {
  type NotificationPreferences,
  notifications,
  useNotificationCatalog,
  useNotificationPreferences,
} from '../queries';

/** A switch per notification kind and channel. Unavailable channels are shown disabled. */
const {
  data: catalog,
  isPending: loadingCatalog,
  error: catalogError,
  refetch: refetchCatalog,
} = useNotificationCatalog();
const {
  data: stored,
  isPending: loadingPrefs,
  error: prefsError,
  refetch: refetchPrefs,
} = useNotificationPreferences();
const loadError = computed(() => catalogError.value ?? prefsError.value);
const retry = () => Promise.all([refetchCatalog(), refetchPrefs()]);

const form = useDraftForm<NotificationPreferences>();
const draft = form.draft as Ref<NotificationPreferences | null>;
const { isDirty, saving } = form;

watch(
  stored,
  (next) => {
    if (next) form.load(plainClone(next), { keepEdits: true });
  },
  { immediate: true },
);

const groups = computed(() => {
  const kinds = catalog.value?.kinds ?? [];
  const labels: Record<string, string> = { content: 'Content', space: 'Spaces' };
  const seen = new Map<string, typeof kinds>();
  for (const kind of kinds) {
    const list = seen.get(kind.group) ?? [];
    list.push(kind);
    seen.set(kind.group, list);
  }
  return [...seen.entries()].map(([id, items]) => ({ id, label: labels[id] ?? id, items }));
});

function set(kind: string, channel: string, value: boolean) {
  if (!draft.value) return;
  const row = draft.value[kind as keyof NotificationPreferences];
  if (row) row[channel as keyof typeof row] = value;
}

async function save() {
  if (!draft.value) return;
  const current = draft.value;
  await form.submit(async () => {
    const saved = await notifications.setPreferences(current);
    form.load(plainClone(saved));
    toast.success('Notification preferences saved');
  });
}
</script>

<template>
  <section class="mb-card space-y-4">
    <div class="flex items-start gap-3">
      <span class="mb-tile-clay flex h-10 w-10 shrink-0 items-center justify-center rounded-card">
        <Icon name="bell" class="mb-icon-lg" />
      </span>
      <div class="min-w-0 flex-1">
        <h2 class="text-base font-bold">What to be told about</h2>
        <p class="mb-meta">
          For each kind of notification, where it should reach you. Off everywhere means you are not told at all.
        </p>
      </div>
      <SaveButton :saving="saving" :disabled="!isDirty" @click="save" />
    </div>

    <AsyncList
      :pending="loadingCatalog || loadingPrefs || (!draft && !loadError)"
      :error="loadError"
      :retry="retry"
      :items="groups"
      :rows="3"
      empty="bare"
      empty-title="There is nothing to be told about yet."
    >
    <div v-if="draft" class="overflow-x-auto">
      <table class="mb-table min-w-[32rem]">
        <thead>
          <tr>
            <th class="mb-th text-left">Notification</th>
            <th v-for="channel in catalog?.channels" :key="channel.id" class="mb-th text-center">
              <span class="block">{{ channel.label }}</span>
              <span v-if="!catalog?.available[channel.id]" class="block text-2xs font-normal normal-case text-surface-400">not set up here</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="group in groups" :key="group.id">
            <tr>
              <td :colspan="1 + (catalog?.channels.length ?? 0)" class="pt-3 pb-1">
                <span class="mb-eyebrow">{{ group.label }}</span>
              </td>
            </tr>
            <tr v-for="kind in group.items" :key="kind.id" class="mb-tr">
              <td class="mb-td pr-4">
                <span class="block font-medium">{{ kind.label }}</span>
                <span class="block mb-meta">{{ kind.description }}</span>
              </td>
              <td v-for="channel in catalog?.channels" :key="channel.id" class="mb-td text-center">
                <Switch
                  compact
                  :model-value="draft[kind.id]?.[channel.id] ?? kind.defaults[channel.id]"
                  :disabled="!catalog?.available[channel.id]"
                  :aria-label="`${kind.label}: ${channel.label}`"
                  @update:model-value="set(kind.id, channel.id, $event)"
                />
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
    </AsyncList>
    <p v-if="catalog && (!catalog.available.email || !catalog.available.push)" class="mb-hint">
      <template v-if="!catalog.available.email">Email needs a mail server configured on the instance. </template>
      <template v-if="!catalog.available.push">Push needs the instance's push keys, and a browser switched on below.</template>
    </p>
  </section>
</template>
