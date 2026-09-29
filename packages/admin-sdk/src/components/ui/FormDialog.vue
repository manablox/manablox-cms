<script setup lang="ts">
import { computed, ref, useId, useTemplateRef } from 'vue';
import Dialog from './Dialog.vue';
import SaveButton from './SaveButton.vue';

/**
 * A dialog around a real `<form>`: Enter submits, Cancel closes, the submit button shows
 * `busy`. `@submit` may return a promise; resolving to `true` closes the dialog.
 */
const props = withDefaults(
  defineProps<{
    title: string;
    /** Tailwind max-width class. */
    width?: string | undefined;
    dismissable?: boolean;
    submitLabel?: string;
    busyLabel?: string;
    cancelLabel?: string;
    /** External busy state, such as `form.saving`. */
    busy?: boolean;
    /** Blocks submitting, such as while a required field is empty. */
    disabled?: boolean;
    /** Styles the submit button as destructive. */
    danger?: boolean;
    /** Classes for the `<form>`. */
    formClass?: string | undefined;
    onSubmit?: (() => unknown) | undefined;
  }>(),
  {
    dismissable: false,
    submitLabel: 'Save',
    busyLabel: 'Saving...',
    cancelLabel: 'Cancel',
    busy: false,
    disabled: false,
    danger: false,
  },
);
const emit = defineEmits<{ close: [] }>();

const formId = useId();
const running = ref(false);
const working = computed(() => props.busy || running.value);
const dialog = useTemplateRef<{ requestClose: () => void }>('dialog');

async function submit() {
  if (working.value || props.disabled || !props.onSubmit) return;
  running.value = true;
  try {
    const result = await props.onSubmit();
    if (result === true) dialog.value?.requestClose();
  } finally {
    running.value = false;
  }
}

defineExpose({ submit, close: () => dialog.value?.requestClose() });
</script>

<template>
  <Dialog ref="dialog" :title="title" :width="width" :dismissable="dismissable" @close="emit('close')">
    <template #default="{ close }">
      <form :id="formId" :class="formClass" @submit.prevent="submit">
        <slot :close="close" :busy="working" />
      </form>
    </template>
    <template #footer="{ close }">
      <slot name="footer-start" :close="close" :busy="working" />
      <span v-if="$slots['footer-start']" class="flex-1" />
      <button type="button" class="mb-btn-ghost" @click="close">{{ cancelLabel }}</button>
      <SaveButton
        type="submit"
        :form="formId"
        :saving="working"
        :disabled="disabled"
        :label="submitLabel"
        :saving-label="busyLabel"
        :variant="danger ? 'danger' : 'primary'"
      />
    </template>
  </Dialog>
</template>
