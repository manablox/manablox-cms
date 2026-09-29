<script setup lang="ts">
import Switch from '@manablox/admin-sdk/components/ui/Switch.vue';
import { computed } from 'vue';
import type { FieldInputProps } from '~/lib/field-input';

const props = defineProps<FieldInputProps>();
const emit = defineEmits<{ 'update:modelValue': [boolean] }>();

const value = computed({
  get: () => props.modelValue === true,
  set: (next: boolean) => emit('update:modelValue', next),
});
</script>

<template>
  <Switch :id="id" v-model="value" compact>{{ value ? 'Yes' : 'No' }}</Switch>
</template>
