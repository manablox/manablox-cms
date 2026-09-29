<script setup lang="ts">
import FeatureGate from '@manablox/admin-sdk/components/feature/FeatureGate.vue';
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import AsyncList from '@manablox/admin-sdk/components/ui/AsyncList.vue';
import Checkbox from '@manablox/admin-sdk/components/ui/Checkbox.vue';
import FormDialog from '@manablox/admin-sdk/components/ui/FormDialog.vue';
import NewButton from '@manablox/admin-sdk/components/ui/NewButton.vue';
import Panel from '@manablox/admin-sdk/components/ui/Panel.vue';
import Radio from '@manablox/admin-sdk/components/ui/Radio.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { useDocumentTypesOf } from '@manablox/admin-sdk/features/content-types/queries';
import { plural } from '@manablox/admin-sdk/lib/format';
import { confirmAndRun, runWrite } from '@manablox/admin-sdk/lib/write';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed, ref } from 'vue';
import PermissionPicker from '~/components/PermissionPicker.vue';
import { apiKeys, useApiKeys } from '../queries';

/** Settings -> API keys: the caller's keys, issued and revoked here. */
const spaces = useSpaceStore();
const { data: list, isPending, error: loadError, refetch } = useApiKeys();

const error = ref<string | null>(null);
/** The secret of the key just issued, shown once. */
const issued = ref<string | null>(null);
const issuing = ref(false);
const session = useSessionStore();
const form = ref<{ name: string; spaceIds: string[]; restrict: boolean; permissions: Set<string> }>(
  {
    name: '',
    spaceIds: [],
    restrict: false,
    permissions: new Set(),
  },
);

function openDialog() {
  if (!session.feature('apiKeys', null).enabled) return;
  error.value = null;
  form.value = { name: '', spaceIds: [], restrict: false, permissions: new Set() };
  issuing.value = true;
}

/** The ticked spaces, or all of the owner's. */
const reachable = computed(() =>
  form.value.spaceIds.length
    ? form.value.spaceIds
    : spaces.spaces.filter((space) => session.can('space:read', space.id)).map((space) => space.id),
);
const { data: reachableTypes } = useDocumentTypesOf(reachable);
/** Types labelled by space when the key spans several. */
const pickerTypes = computed(() =>
  (reachableTypes.value ?? []).map((type) => ({
    id: type.id,
    label: type.label,
    name: type.name,
    hint:
      reachable.value.length > 1
        ? (spaces.spaces.find((space) => space.id === type.spaceId)?.name ?? undefined)
        : undefined,
  })),
);

function toggleSpace(spaceId: string) {
  const ids = form.value.spaceIds;
  form.value.spaceIds = ids.includes(spaceId)
    ? ids.filter((id) => id !== spaceId)
    : [...ids, spaceId];
}

function issue() {
  const name = form.value.name.trim();
  if (!name) return false;
  return runWrite(
    async () => {
      issued.value = await apiKeys.issue(
        name,
        [...form.value.spaceIds],
        form.value.restrict ? [...form.value.permissions] : null,
      );
    },
    { success: `Key "${name}" issued - copy it now`, error },
  );
}

function spaceNames(ids: string[] | null | undefined): string {
  if (!ids?.length) return 'All spaces';
  return ids.map((id) => spaces.spaces.find((space) => space.id === id)?.name ?? id).join(', ');
}

function grantSummary(permissions: string[] | null | undefined): string {
  if (!permissions) return 'everything you may do';
  return plural(permissions.length, 'permission');
}

function revoke(id: string, name: string | null) {
  return confirmAndRun(
    {
      title: `Revoke ${name ?? 'this key'}?`,
      message: 'Any consumer presenting this key stops working immediately.',
      confirmLabel: 'Revoke key',
      danger: true,
    },
    () => apiKeys.revoke(id),
    { success: `Revoked ${name ?? 'the key'}`, error },
  );
}
</script>

<template>
  <Panel
    title="API keys"
    description="Keys for headless delivery consumers and scripts. A key acts as you, narrowed to the spaces and permissions picked here."
    size="lg"
    :card="false"
  >
    <template #actions>
      <FeatureGate feature="apiKeys" instance label="Issue key" trigger-class="mb-btn-primary shrink-0" align="end">
        <div class="shrink-0">
          <NewButton label="Issue an API key" icon="key" @click="openDialog">Issue key</NewButton>
        </div>
      </FeatureGate>
    </template>

    <p v-if="session.me?.controls.apiKeysDisable" class="mb-callout mb-3 flex items-start gap-2 text-sm" role="note">
      <Icon name="lock" class="mb-icon-sm mt-0.5 shrink-0" />
      <span>API keys are switched off on this instance: requests that present one are refused. The keys are kept and can still be revoked.</span>
    </p>

    <div v-if="issued" class="mb-callout mb-3">
      <p class="font-medium">Copy this key now - it is never shown again.</p>
      <code class="mt-2 block mb-surface-card rounded-control px-2 py-1.5 font-mono text-xs break-all select-all">{{ issued }}</code>
      <button type="button" class="mt-2 text-xs underline" @click="issued = null">Dismiss</button>
    </div>

    <AsyncList
      :pending="isPending"
      :error="loadError"
      :retry="refetch"
      :items="list"
      empty-icon="key"
      empty-title="No keys yet"
      empty-description="Issue one for a headless delivery consumer."
      empty="block"
      list-class="text-sm"
      item-class="flex items-center gap-2 py-2"
    >
      <template #item="{ item: key }">
        <span class="min-w-0 flex-1">
          <span class="block truncate">{{ key.name }}</span>
          <span class="block truncate mb-meta">{{ spaceNames(key.spaceIds) }} - {{ grantSummary(key.permissions) }}</span>
        </span>
        <code class="font-mono mb-meta">{{ key.start }}...</code>
        <button type="button" class="mb-btn-ghost-danger mb-btn-sm" @click="revoke(key.id, key.name)">
          <Icon name="trash" /> Revoke
        </button>
      </template>
    </AsyncList>
    <p v-if="error && !issuing" class="mb-error mt-2">{{ error }}</p>

    <FormDialog
      v-if="issuing"
      title="Issue API key"
      :width="form.restrict ? 'max-w-3xl' : undefined"
      submit-label="Issue key"
      busy-label="Issuing..."
      :disabled="!form.name.trim()"
      form-class="space-y-3"
      :on-submit="issue"
      @close="issuing = false"
    >
      <TextField v-model="form.name" label="Name" required placeholder="production site" />
      <fieldset>
        <legend class="mb-label">Restrict to spaces</legend>
        <Checkbox
          v-for="space in spaces.spaces"
          :key="space.id"
          class="py-0.5"
          :model-value="form.spaceIds.includes(space.id)"
          @update:model-value="toggleSpace(space.id)"
        >
          {{ space.name }}
        </Checkbox>
        <p class="mb-hint">Leave every box unticked for a key that reaches all of your spaces.</p>
      </fieldset>
      <fieldset>
        <legend class="mb-label">Permissions</legend>
        <Radio v-model="form.restrict" :value="false" name="k-restrict" class="py-0.5">Everything I may do</Radio>
        <Radio v-model="form.restrict" :value="true" name="k-restrict" class="py-0.5">Only these</Radio>
        <p class="mb-hint">
          A restriction only narrows: what the key may do is what you may do, cut down to the grants ticked.
        </p>
        <div v-if="form.restrict" class="mt-3 max-h-[50vh] overflow-y-auto rounded-card border border-surface-200 px-3 dark:border-surface-800">
          <PermissionPicker
            :model-value="form.permissions"
            :read-only="false"
            :types="pickerTypes"
            content-note="Types of every space the key reaches; tick spaces above to narrow the list."
            dense
            @update:model-value="form.permissions = $event"
          />
        </div>
      </fieldset>
      <p v-if="error" class="mb-error">{{ error }}</p>
    </FormDialog>
  </Panel>
</template>
