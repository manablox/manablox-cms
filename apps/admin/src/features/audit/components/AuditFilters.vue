<script setup lang="ts">
import IconButton from '@manablox/admin-sdk/components/ui/IconButton.vue';
import SearchField from '@manablox/admin-sdk/components/ui/SearchField.vue';
import Select from '@manablox/admin-sdk/components/ui/Select.vue';
import type { AuditAction } from '@manablox/core';
import { computed } from 'vue';
import { pluginActionLabels } from '~/lib/plugins/registry';
import { type AuditFilterForm, emptyFilter, hasFilter, targetKindLabel } from '../model';
import type { AuditCatalog } from '../queries';

/** The audit filter bar, as a grid that folds from one row to two to a column. */
const props = defineProps<{
  modelValue: AuditFilterForm;
  catalog: AuditCatalog | undefined;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: AuditFilterForm] }>();

function set<K extends keyof AuditFilterForm>(key: K, value: AuditFilterForm[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: value });
}

const toOption = <T extends string>(item: { id: T; label: string }) => ({
  value: item.id,
  label: item.label,
});
const actorKinds = computed(() => [
  { value: '' as const, label: 'Anyone' },
  ...(props.catalog?.actorKinds ?? []).map(toOption),
]);
const targetKinds = computed(() => [
  { value: '' as const, label: 'Anything' },
  ...(props.catalog?.targetKinds ?? []).map((item) => ({
    value: item.id,
    label: targetKindLabel(item.id),
  })),
]);
/** Core actions from the catalog, plugin actions from the plugins' admin bundles. */
const actions = computed(() => [
  { value: '' as const, label: 'Any action' },
  ...(props.catalog?.actions ?? []).map((item) => ({
    value: item.id,
    label: item.label,
    hint: item.id,
  })),
  ...[...pluginActionLabels()].map(([id, label]) => ({
    value: id as AuditAction,
    label,
    hint: id,
  })),
]);

const active = computed(() => hasFilter(props.modelValue));
/** The time range, written when an input commits its value. */
const from = computed({
  get: () => props.modelValue.from,
  set: (value) => set('from', value),
});
const to = computed({
  get: () => props.modelValue.to,
  set: (value) => set('to', value),
});
</script>

<template>
  <div class="mb-card grid gap-x-3 gap-y-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_8.5rem_13rem_9.5rem_auto]">
    <div class="min-w-0 sm:col-span-2 xl:col-span-1">
      <span class="mb-label" aria-hidden="true">Search</span>
      <SearchField
        :model-value="modelValue.search"
        label="Search the activity log"
        shortcut="Search the activity log"
        placeholder="Who or what..."
        @update:model-value="set('search', $event)"
      />
    </div>

    <label class="min-w-0">
      <span class="mb-label">Who</span>
      <Select :model-value="modelValue.actorKind" :options="actorKinds" @update:model-value="set('actorKind', $event)" />
    </label>

    <label class="min-w-0">
      <span class="mb-label">Action</span>
      <Select :model-value="modelValue.action" :options="actions" @update:model-value="set('action', $event)" />
    </label>

    <label class="min-w-0">
      <span class="mb-label">Kind</span>
      <Select :model-value="modelValue.targetKind" :options="targetKinds" @update:model-value="set('targetKind', $event)" />
    </label>

    <div class="min-w-0 sm:col-span-2 xl:col-span-1">
      <span class="mb-label">Between</span>
      <div class="flex items-center gap-2">
        <input v-model.lazy="from" type="datetime-local" class="mb-input min-w-0 flex-1 xl:w-[11.5rem] xl:flex-none" aria-label="From" />
        <span class="shrink-0 text-xs text-surface-400">and</span>
        <input v-model.lazy="to" type="datetime-local" class="mb-input min-w-0 flex-1 xl:w-[11.5rem] xl:flex-none" aria-label="To" />
        <IconButton
          v-if="active"
          icon="x"
          label="Clear the filter"
          size="md"
          class="shrink-0"
          @click="emit('update:modelValue', emptyFilter())"
        />
      </div>
    </div>
  </div>
</template>
