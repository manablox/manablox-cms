<script setup lang="ts">
import FormDialog from '@manablox/admin-sdk/components/ui/FormDialog.vue';
import { runWrite } from '@manablox/admin-sdk/lib/write';
import { ref } from 'vue';
import { users } from '../queries';
import NewPasswordField from './NewPasswordField.vue';

/** An admin password reset; ends every existing session. */
const props = defineProps<{ userId: string; label: string }>();
const emit = defineEmits<{ close: [] }>();

const password = ref('');
const error = ref<string | null>(null);

function submit() {
  return runWrite(() => users.setPassword(props.userId, password.value), {
    success: `Password reset for ${props.label} - they are signed out everywhere`,
    error,
  });
}
</script>

<template>
  <FormDialog
    :title="`Reset password for ${label}`"
    submit-label="Reset password"
    busy-label="Resetting..."
    form-class="space-y-3"
    :on-submit="submit"
    @close="emit('close')"
  >
    <NewPasswordField
      v-model="password"
      label="New password"
      hint="At least 12 characters. Every session of theirs ends; they sign in again with this."
    />
    <p v-if="error" class="mb-error">{{ error }}</p>
  </FormDialog>
</template>
