<script setup lang="ts">
import { SaveButton } from '@manablox/admin-sdk';
import AiSparkles from './AiSparkles.vue';

/** The button that starts a design job: a wand, sparkles while the model works. */
defineProps<{ busy: boolean; label: string; disabled?: boolean | undefined }>();
defineEmits<{ click: [] }>();
</script>

<template>
  <SaveButton :saving="busy" icon="wand" variant="outline" :disabled="disabled" class="ai:relative" @click="$emit('click')">
    <AiSparkles :active="busy" />
    {{ label }}
  </SaveButton>
</template>
