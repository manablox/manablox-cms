<script setup lang="ts">
import FormDialog from '@manablox/admin-sdk/components/ui/FormDialog.vue';
import TextareaField from '@manablox/admin-sdk/components/ui/TextareaField.vue';
import { ref } from 'vue';

/** The shared review step dialog: a title, a note and the verb. */
withDefaults(
  defineProps<{
    title: string;
    description?: string | undefined;
    confirmLabel: string;
    placeholder?: string | undefined;
    /** Whether the note may be empty. */
    optional?: boolean;
    danger?: boolean;
  }>(),
  { optional: true, danger: false },
);
const emit = defineEmits<{ close: []; confirm: [note: string] }>();

const note = ref('');
const busy = ref(false);

function submit() {
  if (busy.value) return;
  busy.value = true;
  emit('confirm', note.value.trim());
}
</script>

<template>
  <FormDialog
    :title="title"
    :submit-label="confirmLabel"
    :busy-label="confirmLabel"
    :busy="busy"
    :disabled="!optional && !note.trim()"
    :danger="danger"
    form-class="space-y-3"
    @submit="submit"
    @close="emit('close')"
  >
    <p v-if="description" class="text-sm text-surface-500">{{ description }}</p>
    <TextareaField
      v-model="note"
      class="min-h-24"
      :placeholder="placeholder"
      :required="!optional"
      maxlength="2000"
      autofocus
    >
      <template #label>Note<span v-if="optional" class="font-normal text-surface-400"> (optional)</span></template>
    </TextareaField>
  </FormDialog>
</template>
