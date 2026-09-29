<script setup lang="ts">
import type { FieldDefinition } from '@manablox/admin-sdk/lib/api-types';
import FieldRenderer from '~/components/FieldRenderer.vue';

/** Four-column field grid sized by `admin.width`, for documents and blocks. */
defineProps<{
  fields: FieldDefinition[];
  values: Record<string, unknown>;
  /** Base path for error lookup. */
  path: (string | number)[];
}>();
defineEmits<{ update: [name: string, value: unknown] }>();
</script>

<template>
  <div class="grid grid-cols-4 gap-x-4 gap-y-5">
    <FieldRenderer
      v-for="field in fields"
      :key="field.id"
      :field="field"
      :model-value="values[field.name]"
      :path="[...path, field.name]"
      @update:model-value="$emit('update', field.name, $event)"
    />
  </div>
</template>
