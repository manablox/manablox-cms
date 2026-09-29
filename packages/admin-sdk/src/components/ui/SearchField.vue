<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useAttrs, useTemplateRef, watch } from 'vue';
import { useSearchShortcut } from '../../composables/useSearchShortcut';
import Icon from '../Icon.vue';

/**
 * A labelled search box with a leading icon. `v-model` is the debounced value; `input`
 * fires on every keystroke. Classes land on the wrapper, other attributes on the input.
 */
defineOptions({ inheritAttrs: false });

const model = defineModel<string>({ default: '' });
const props = withDefaults(
  defineProps<{
    /** Accessible name, visually hidden. */
    label: string;
    size?: 'sm' | 'default' | 'lg';
    /** Milliseconds after the last keystroke; 0 updates at once. */
    debounce?: number;
    /** Binds `/` to focus the box; a string names the shortcut in the help dialog. */
    shortcut?: boolean | string;
  }>(),
  { size: 'default', debounce: 250, shortcut: false },
);
const emit = defineEmits<{ input: [value: string] }>();

const attrs = useAttrs();
const inputAttrs = computed(() => {
  const { class: _class, style: _style, ...rest } = attrs;
  return rest;
});

const input = useTemplateRef<HTMLInputElement>('input');
const text = ref(model.value);
let timer: ReturnType<typeof setTimeout> | null = null;

// An outside change, such as a reset, replaces the typed text.
watch(model, (value) => {
  if (value !== text.value) {
    cancel();
    text.value = value;
  }
});

function cancel() {
  if (timer) clearTimeout(timer);
  timer = null;
}

function flush() {
  cancel();
  if (model.value !== text.value) model.value = text.value;
}

function onInput(event: Event) {
  text.value = (event.target as HTMLInputElement).value;
  emit('input', text.value);
  cancel();
  if (props.debounce <= 0 || text.value === '') flush();
  else timer = setTimeout(flush, props.debounce);
}

onBeforeUnmount(cancel);

if (props.shortcut) {
  useSearchShortcut(input, typeof props.shortcut === 'string' ? props.shortcut : undefined);
}

defineExpose({ input, focus: () => input.value?.focus(), flush });
</script>

<template>
  <label class="relative block" :class="attrs.class" :style="attrs.style as string | undefined">
    <span class="sr-only">{{ label }}</span>
    <Icon name="search" class="mb-input-icon" />
    <input
      ref="input"
      v-bind="inputAttrs"
      :value="text"
      type="search"
      autocomplete="off"
      class="mb-input mb-input-leading"
      :class="size === 'sm' ? 'mb-input-sm' : size === 'lg' ? 'mb-input-lg' : ''"
      @input="onInput"
      @change="flush"
    />
  </label>
</template>
