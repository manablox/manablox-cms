<script setup lang="ts">
import { useFieldContext } from '@manablox/admin-sdk/lib/field-context';
import type { BlockValue } from '@manablox/core';
import { computed } from 'vue';
import FieldGrid from '~/features/content/components/FieldGrid.vue';

/** Edits a block's fields through the same field grid as documents, recursively. */
const props = defineProps<{ block: BlockValue; path: (string | number)[] }>();
const emit = defineEmits<{ 'update:fields': [Record<string, unknown>] }>();

const context = useFieldContext();
const type = computed(() => context.value.typeById(props.block.type));

const fields = computed(() =>
  (type.value?.fields ?? []).slice().sort((a, b) => a.admin.position - b.admin.position),
);
/** `sidebar` fields go in a narrower side column, as on documents. */
const mainFields = computed(() => fields.value.filter((field) => field.admin.zone !== 'sidebar'));
const sidebarFields = computed(() =>
  fields.value.filter((field) => field.admin.zone === 'sidebar'),
);

function update(name: string, value: unknown) {
  emit('update:fields', { ...props.block.fields, [name]: value });
}
</script>

<template>
  <div v-if="!type" class="mb-hint">Unknown block type.</div>
  <div v-else class="grid gap-4" :class="sidebarFields.length ? 'md:grid-cols-[minmax(0,1fr)_minmax(14rem,30%)]' : ''">
    <FieldGrid
      v-if="mainFields.length"
      :fields="mainFields"
      :values="block.fields"
      :path="path"
      @update="update"
    />
    <div
      v-if="sidebarFields.length"
      class="mb-surface-inset rounded-control p-3"
      :class="mainFields.length ? '' : 'md:col-span-2'"
    >
      <FieldGrid :fields="sidebarFields" :values="block.fields" :path="path" @update="update" />
    </div>
  </div>
</template>
