<script setup lang="ts">
import { TextareaField, TextField } from '@manablox/admin-sdk';
import type { LocalizedText } from '@manablox/site';
import { computed, ref } from 'vue';

/**
 * Static text per locale: the current locale up front, the others behind a toggle. Emptied
 * locales are dropped; nothing left emits `undefined`.
 */
const props = defineProps<{
  modelValue: unknown;
  label: string;
  locales: readonly string[];
  locale: string;
  hint?: string | undefined;
  multiline?: boolean;
  readOnly?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: LocalizedText | undefined] }>();

const current = computed<LocalizedText>(() =>
  props.modelValue && typeof props.modelValue === 'object'
    ? (props.modelValue as LocalizedText)
    : {},
);
const others = computed(() => props.locales.filter((entry) => entry !== props.locale));
const showOthers = ref(false);
const filled = computed(() => others.value.filter((entry) => current.value[entry]).length);

function set(locale: string, value: string | null | undefined) {
  if (props.readOnly) return;
  const next: LocalizedText = { ...current.value };
  if (value) next[locale] = value;
  else delete next[locale];
  emit('update:modelValue', Object.keys(next).length ? next : undefined);
}

const field = computed(() => (props.multiline ? TextareaField : TextField));
</script>

<template>
  <div class="ws:space-y-2">
    <component
      :is="field"
      :model-value="current[locale] ?? ''"
      :label="locales.length > 1 ? `${label} (${locale})` : label"
      :hint="hint"
      :disabled="readOnly"
      @update:model-value="set(locale, $event as string)"
    />
    <template v-if="others.length">
      <button type="button" class="mb-btn-ghost mb-btn-sm" :aria-expanded="showOthers" @click="showOthers = !showOthers">
        Other languages{{ filled ? ` (${filled} of ${others.length})` : '' }}
      </button>
      <div v-if="showOthers" class="ws:space-y-2 ws:border-l-2 ws:border-surface-200 ws:pl-3 ws:dark:border-surface-700">
        <component
          :is="field"
          v-for="entry in others"
          :key="entry"
          :model-value="current[entry] ?? ''"
          :label="`${label} (${entry})`"
          :placeholder="current[locale] ?? ''"
          :disabled="readOnly"
          @update:model-value="set(entry, $event as string)"
        />
      </div>
    </template>
  </div>
</template>
