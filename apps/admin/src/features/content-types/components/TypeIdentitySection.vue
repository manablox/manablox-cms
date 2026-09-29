<script setup lang="ts">
import IconPicker from '@manablox/admin-sdk/components/ui/IconPicker.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { type ContentTypeDraft, KIND_ICONS } from '../model';

/** A type's label, icon and technical name. The icon is edited in place on `draft`. */
defineProps<{
  draft: ContentTypeDraft;
  readOnly: boolean;
  nameError: string | null | undefined;
}>();

const emit = defineEmits<{
  label: [value: string];
  name: [value: string];
  nameBlur: [];
}>();
</script>

<template>
  <div class="mb-card grid gap-4 sm:grid-cols-2">
    <TextField
      label="Label"
      :model-value="draft.label"
      :disabled="readOnly"
      @update:model-value="emit('label', String($event ?? ''))"
    />
    <div>
      <p class="mb-label">Icon</p>
      <IconPicker
        id="ct-icon"
        v-model="draft.icon"
        :fallback="KIND_ICONS[draft.kind]"
        :disabled="readOnly"
      />
      <p class="mb-hint">
        Stands for the type wherever it appears - {{ draft.kind === 'data' ? 'the databag list' : 'the tree, the lists' }}, the pickers.
      </p>
    </div>
    <TextField
      label="Technical name"
      :model-value="draft.name"
      :disabled="readOnly || Boolean(draft.id)"
      class="mb-input-mono"
      hint="Filled in from the label and corrected as you type. Used in the GraphQL schema, so it is immutable once created."
      :error="nameError"
      @update:model-value="emit('name', String($event ?? ''))"
      @blur="emit('nameBlur')"
    />
  </div>
</template>
