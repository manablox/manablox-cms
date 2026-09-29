<script setup lang="ts">
import { TextField } from '@manablox/admin-sdk';

defineProps<{
  draft: Record<string, unknown>;
  setDraft: (patch: Record<string, unknown>) => void;
}>();
</script>

<template>
  <TextField
    label="First greeting"
    :model-value="String(draft.greeting ?? '')"
    @update:model-value="setDraft({ greeting: String($event ?? '') })"
  />
</template>
