<script setup lang="ts">
import { isThemeColor } from '@manablox/site';
import { computed, ref, useId, watch } from 'vue';
import { toHex } from '../model/color';

/**
 * A CSS color, typed or picked with the system picker. With `palette`, a palette entry's
 * name is accepted too and offered as a suggestion. Emits on commit.
 */
const props = defineProps<{
  modelValue: string | undefined;
  palette?: Record<string, string> | undefined;
  id?: string | undefined;
  ariaLabel?: string | undefined;
  disabled?: boolean | undefined;
  placeholder?: string | undefined;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const text = ref(props.modelValue ?? '');
watch(
  () => props.modelValue,
  (value) => {
    text.value = value ?? '';
  },
);

const listId = useId();
const resolved = computed(() => {
  const value = text.value.trim();
  return props.palette?.[value] ?? value;
});
const hex = computed(() => toHex(resolved.value) ?? '#000000');
const readable = computed(() => text.value.trim() === '' || isThemeColor(resolved.value));

function commit() {
  const value = text.value.trim();
  if (value && readable.value && value !== props.modelValue) emit('update:modelValue', value);
}

function pick(event: Event) {
  text.value = (event.target as HTMLInputElement).value;
  commit();
}
</script>

<template>
  <div class="ws:flex ws:items-center ws:gap-2">
    <label
      class="ws:relative ws:h-[var(--ws-mb-control-h)] ws:w-[var(--ws-mb-control-h)] ws:shrink-0 ws:cursor-pointer ws:overflow-hidden ws:rounded-control ws:border ws:border-surface-300 ws:dark:border-surface-600"
      :style="{ background: readable ? resolved : 'transparent' }"
      :title="disabled ? undefined : 'Pick a color'"
    >
      <input
        type="color"
        class="ws:absolute ws:inset-0 ws:cursor-pointer ws:opacity-0"
        :value="hex"
        :disabled="disabled"
        :aria-label="ariaLabel ? `${ariaLabel}: picker` : 'Color picker'"
        @change="pick"
      />
    </label>
    <input
      :id="id"
      v-model="text"
      class="mb-input mb-input-mono ws:min-w-0 ws:flex-1"
      :class="readable ? '' : 'mb-invalid'"
      :list="palette ? listId : undefined"
      :aria-label="ariaLabel"
      :aria-invalid="!readable"
      :disabled="disabled"
      :placeholder="placeholder ?? '#1d4ed8'"
      spellcheck="false"
      autocomplete="off"
      @change="commit"
      @keydown.enter.prevent="commit"
    />
    <datalist v-if="palette" :id="listId">
      <option v-for="(value, name) in palette" :key="name" :value="name">{{ value }}</option>
    </datalist>
  </div>
</template>
