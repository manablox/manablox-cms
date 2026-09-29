<script setup lang="ts">
import { FormDialog, runWrite, TextField } from '@manablox/admin-sdk';
import { ref } from 'vue';
import { licenses } from '../queries';

/** Adds a key in the admin; it is stored encrypted and activated right away. */
const emit = defineEmits<{ close: [] }>();

const key = ref('');
const error = ref<string | null>(null);

/** A key whose activation failed stays; its row says why. */
const submit = () =>
  runWrite(() => licenses.add(key.value), {
    error,
    success: (view) =>
      view.error
        ? `Added ${view.keyId}; it is not active yet`
        : `Added and activated ${view.keyId}`,
  });
</script>

<template>
  <FormDialog
    title="Add a license key"
    submit-label="Add key"
    busy-label="Activating..."
    :disabled="!key.trim()"
    :on-submit="submit"
    @close="emit('close')"
  >
    <TextField
      v-model="key"
      label="License key"
      placeholder="MBX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
      class="mb-input-mono"
      autocomplete="off"
      spellcheck="false"
      hint="Stored encrypted in the database and activated for this instance. Keys in MANABLOX_LICENSE_KEYS need no adding."
      :error="error"
    />
  </FormDialog>
</template>
