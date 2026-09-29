<script setup lang="ts">
import { computed } from 'vue';
import { chosen, pending, settle, typed } from '../../lib/confirm';
import Dialog from './Dialog.vue';
import RadioCard from './RadioCard.vue';
import TextField from './TextField.vue';

// Unlocks on an exact (trimmed) match of `requireText`, if set.
const unlocked = computed(
  () => !pending.value?.requireText || typed.value.trim() === pending.value.requireText,
);
</script>

<template>
  <Dialog v-if="pending" :title="pending.title" width="max-w-md" @close="settle(false)">
    <p class="text-sm">{{ pending.message }}</p>

    <div v-if="pending.choices?.length" class="mt-3 space-y-1.5">
      <RadioCard
        v-for="option in pending.choices"
        :key="option.value"
        v-model="chosen"
        name="confirm-choice"
        :value="option.value"
        :title="option.label"
        :hint="option.description"
      />
    </div>

    <!-- eslint-disable-next-line vue/no-autofocus -- the dialog exists to take this input -->
    <TextField v-if="pending.requireText" v-model="typed" autofocus class="mb-input-mono" field-class="mt-3">
      <template #label>Type <code class="font-mono">{{ pending.requireText }}</code> to confirm</template>
    </TextField>

    <template #footer="{ close }">
      <button class="mb-btn-ghost" @click="close">{{ pending.cancelLabel ?? 'Cancel' }}</button>
      <button
        :class="pending.danger ? 'mb-btn-danger' : 'mb-btn-primary'"
        :disabled="!unlocked"
        @click="settle(true)"
      >
        {{ pending.confirmLabel ?? 'Confirm' }}
      </button>
    </template>
  </Dialog>
</template>
