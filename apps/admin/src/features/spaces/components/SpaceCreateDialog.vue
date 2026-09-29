<script setup lang="ts">
import FormDialog from '@manablox/admin-sdk/components/ui/FormDialog.vue';
import { computed, useTemplateRef } from 'vue';
import SpaceCreateForm from './SpaceCreateForm.vue';

/** The space creation form in a dialog, one page per stage of the form. */
withDefaults(
  defineProps<{
    /** Preselects a preconfigured space, for the empty state's second button. */
    starter?: boolean;
  }>(),
  { starter: false },
);
const emit = defineEmits<{ close: []; created: [] }>();
const form = useTemplateRef<InstanceType<typeof SpaceCreateForm>>('form');
const later = computed<boolean>(() => form.value?.first === false);
</script>

<template>
  <FormDialog
    :title="later ? `New space: ${form?.stageLabel.toLowerCase()}` : 'New space'"
    width="max-w-3xl"
    :submit-label="form?.nextLabel ?? 'Create space'"
    busy-label="Creating..."
    :busy="form?.busy ?? false"
    :on-submit="() => form?.submit()"
    @close="emit('close')"
  >
    <SpaceCreateForm ref="form" :starter="starter" embedded @created="emit('created')" />
    <template v-if="later" #footer-start>
      <button type="button" class="mb-btn-ghost" @click="form?.back()">Back</button>
    </template>
  </FormDialog>
</template>
