<script setup lang="ts">
import FormField from '@manablox/admin-sdk/components/ui/FormField.vue';

/** A new password in plain sight, with a generator; at least 12 characters. */
const model = defineModel<string>({ required: true });
defineProps<{ label: string; hint: string }>();

function generate() {
  // 20 characters from a URL-safe alphabet, from the browser's CSPRNG.
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  model.value = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}
</script>

<template>
  <FormField :label="label" :hint="hint" v-slot="{ id }">
    <div class="flex gap-2">
      <input
        :id="id"
        v-model="model"
        type="text"
        required
        minlength="12"
        class="mb-input mb-input-mono"
        autocomplete="new-password"
        spellcheck="false"
      />
      <button type="button" class="mb-btn-outline shrink-0" @click="generate">Generate</button>
    </div>
  </FormField>
</template>
