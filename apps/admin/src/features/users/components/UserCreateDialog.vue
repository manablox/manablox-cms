<script setup lang="ts">
import FormDialog from '@manablox/admin-sdk/components/ui/FormDialog.vue';
import FormField from '@manablox/admin-sdk/components/ui/FormField.vue';
import Select from '@manablox/admin-sdk/components/ui/Select.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { detailAt, errorDetails } from '@manablox/admin-sdk/lib/api-errors';
import { messageFor, messageForKey } from '@manablox/admin-sdk/lib/messages';
import { runWrite } from '@manablox/admin-sdk/lib/write';
import { ref } from 'vue';
import { INSTANCE_ROLES, type InstanceRole, users } from '../queries';
import NewPasswordField from './NewPasswordField.vue';

/** Creates an account with a password; sign-up closes after the first account. */
const emit = defineEmits<{ close: []; created: [userId: string] }>();

const form = ref<{ name: string; email: string; password: string; role: InstanceRole }>({
  name: '',
  email: '',
  password: '',
  role: 'editor',
});
const error = ref<string | null>(null);
const emailError = ref<string | null>(null);

/** An email error goes to its field, anything else under the form. */
function describe(err: unknown): string {
  const atEmail = detailAt(errorDetails(err), ['email']);
  if (atEmail) {
    emailError.value = messageForKey(atEmail.key, atEmail.params);
    return emailError.value;
  }
  const message = messageFor(err);
  error.value = message;
  return message;
}

function submit() {
  error.value = null;
  emailError.value = null;
  return runWrite(
    async () => {
      const created = await users.create({
        name: form.value.name.trim(),
        email: form.value.email.trim(),
        password: form.value.password,
        role: form.value.role,
      });
      emit('created', created.id);
      return created;
    },
    { success: (created) => `Created ${created.name || created.email}`, describe },
  );
}
</script>

<template>
  <FormDialog
    title="New user"
    submit-label="Create user"
    busy-label="Creating..."
    form-class="space-y-3"
    :on-submit="submit"
    @close="emit('close')"
  >
    <TextField v-model="form.name" label="Name" required autocomplete="off" />
    <TextField v-model="form.email" label="Email" type="email" required autocomplete="off" :error="emailError" />
    <NewPasswordField
      v-model="form.password"
      label="Password"
      hint="At least 12 characters. Share it with them out of band; they can change it after signing in."
    />
    <FormField
      label="Instance role"
      hint="An administrator reaches every space. A member only reaches the spaces they are added to."
      v-slot="{ id }"
    >
      <Select :id="id" v-model="form.role" :options="INSTANCE_ROLES" />
    </FormField>
    <p v-if="error" class="mb-error">{{ error }}</p>
  </FormDialog>
</template>
