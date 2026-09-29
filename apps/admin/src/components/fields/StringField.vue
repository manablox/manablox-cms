<script setup lang="ts">
import { computed } from 'vue';
import type { FieldInputProps } from '~/lib/field-input';

const props = defineProps<FieldInputProps>();
const emit = defineEmits<{ 'update:modelValue': [string] }>();

const value = computed({
  get: () => (typeof props.modelValue === 'string' ? props.modelValue : ''),
  set: (next: string) => emit('update:modelValue', next),
});

const editor = computed(() => (props.settings.editor as string) ?? 'input');
const max = computed(() => props.settings.max as number | undefined);
</script>

<template>
  <textarea
    v-if="editor === 'textarea'"
    :id="id"
    v-model="value"
    rows="4"
    class="mb-input resize-y"
    :maxlength="max"
  />
  <textarea
    v-else-if="editor === 'code'"
    :id="id"
    v-model="value"
    rows="10"
    spellcheck="false"
    class="mb-input mb-input-mono resize-y"
  />
  <input v-else :id="id" v-model="value" class="mb-input" :maxlength="max" />

  <p v-if="max" class="mb-hint">{{ value.length }} / {{ max }}</p>
</template>
