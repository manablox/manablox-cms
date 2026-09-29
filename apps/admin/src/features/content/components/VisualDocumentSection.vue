<script setup lang="ts">
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import type { DraftDocument } from '@manablox/admin-sdk/features/content/model/draft';
import type { FieldDefinition } from '@manablox/admin-sdk/lib/api-types';
import FieldRenderer from '~/components/FieldRenderer.vue';
import FieldGrid from './FieldGrid.vue';

/**
 * The visual editor's panel while nothing is selected: the document's title and plain fields,
 * then the active block field. The title is edited in place on `document`.
 */
defineProps<{
  document: DraftDocument;
  scalarFields: FieldDefinition[];
  /** The block field shown, if the type has one. */
  field: FieldDefinition | null;
  blockCount: number;
  hasGrid: boolean;
  deviceLabel: string;
  readOnly: boolean;
}>();

const emit = defineEmits<{ update: [name: string, value: unknown] }>();
</script>

<template>
  <section class="space-y-3 border-b border-surface-200 p-4 dark:border-surface-800">
    <h3 class="mb-eyebrow">Document</h3>
    <TextField id="visual-title" label="Title" :readonly="readOnly" :model-value="document.title" @update:model-value="document.title = String($event ?? '')" />
    <FieldGrid
      v-if="scalarFields.length"
      :fields="scalarFields"
      :values="document.fields"
      :path="[]"
      @update="(name, value) => emit('update', name, value)"
    />
  </section>

  <section v-if="field" class="space-y-3 p-4">
    <div class="flex items-center justify-between">
      <h3 class="mb-eyebrow">{{ field.label }}</h3>
      <span class="text-2xs text-surface-500">
        {{ blockCount }} {{ blockCount === 1 ? 'block' : 'blocks' }}{{ hasGrid ? ` - ${deviceLabel} grid` : '' }}
      </span>
    </div>
    <p v-if="readOnly" class="mb-meta">
      Click a block in the preview to see its fields. You can view this document but not change it.
    </p>
    <p v-else class="mb-meta">
      Click a block in the preview to edit it, double-click text to edit it in place, or drag blocks by their toolbar.
    </p>
    <FieldRenderer
      :field="field"
      :model-value="document.fields[field.name]"
      :path="[field.name]"
      @update:model-value="emit('update', field.name, $event)"
    />
  </section>
  <p v-else class="p-4 text-sm text-surface-500">
    This content type has no block field, so there is nothing to lay out visually.
  </p>
</template>
