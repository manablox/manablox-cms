<script setup lang="ts">
import { isSize } from '@manablox/site';
import { computed, ref, useId, watch } from 'vue';

/**
 * A raw size with a unit (`24rem`, `50%`), a keyword like `auto`, or a container width
 * (`container:lg`). Emits on commit; an invalid entry is kept and marked, empty clears.
 */
const props = defineProps<{
  modelValue: string | undefined;
  keywords?: readonly string[] | undefined;
  /** Container widths offered as `container:<name>`. */
  containers?: Record<string, string> | undefined;
  placeholder?: string | undefined;
  id?: string | undefined;
  disabled?: boolean | undefined;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string | undefined] }>();

const text = ref(props.modelValue ?? '');
watch(
  () => props.modelValue,
  (value) => {
    text.value = value ?? '';
  },
);

const listId = useId();
const suggestions = computed(() => [
  ...(props.keywords ?? []),
  ...Object.keys(props.containers ?? {}).map((name) => `container:${name}`),
]);

const sized = (value: string): boolean => isSize(value);
const valid = (value: string) =>
  value === '' ||
  sized(value) ||
  (props.keywords ?? []).includes(value) ||
  (value.startsWith('container:') && Object.hasOwn(props.containers ?? {}, value.slice(10)));
const invalid = computed(() => !valid(text.value.trim()));

function commit() {
  const value = text.value.trim();
  if (!valid(value) || value === (props.modelValue ?? '')) return;
  emit('update:modelValue', value === '' ? undefined : value);
}
</script>

<template>
  <div>
    <input
      :id="id"
      v-model="text"
      class="mb-input mb-input-mono"
      :class="invalid ? 'mb-invalid' : ''"
      :list="suggestions.length ? listId : undefined"
      :placeholder="placeholder ?? 'e.g. 24rem'"
      :disabled="disabled"
      :aria-invalid="invalid"
      spellcheck="false"
      autocomplete="off"
      @change="commit"
      @keydown.enter.prevent="commit"
    />
    <datalist v-if="suggestions.length" :id="listId">
      <option v-for="entry in suggestions" :key="entry" :value="entry" />
    </datalist>
    <p v-if="invalid" class="mb-error">Use a number with a unit (px, rem, em, %, vw, vh, ch){{ suggestions.length ? ' or one of the suggestions' : '' }}.</p>
  </div>
</template>
