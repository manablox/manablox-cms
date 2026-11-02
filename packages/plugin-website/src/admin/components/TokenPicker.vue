<script setup lang="ts">
import { Icon, Popover, Select } from '@manablox/admin-sdk';
import type { ThemeDesign, TokenGroup } from '@manablox/site';
import { computed, ref } from 'vue';
import { colorRefCss, joinColorRef, splitColorRef, tokenOptions } from '../model/tokens';

/**
 * Picks a theme token as a `<group>:<name>` reference. Colors show swatches and take an
 * opacity (`color:primary/50`); `extra` adds plain values like `0` or `auto`. Empty is
 * "inherit", emitted as `undefined`.
 */
const props = withDefaults(
  defineProps<{
    modelValue: string | undefined;
    group: TokenGroup;
    theme: ThemeDesign;
    extra?: readonly string[] | undefined;
    /** What an empty value falls back to, shown in its place. */
    inherited?: string | undefined;
    /** Colors only: offer the opacity slider. */
    alpha?: boolean;
    id?: string | undefined;
    ariaLabel?: string | undefined;
    disabled?: boolean;
  }>(),
  { alpha: true, disabled: false },
);
const emit = defineEmits<{ 'update:modelValue': [value: string | undefined] }>();

const options = computed(() => tokenOptions(props.theme, props.group));

const selectOptions = computed(() => [
  { value: '', label: props.inherited ? `Inherit (${props.inherited})` : 'Theme default' },
  ...(props.extra ?? []).map((value) => ({ value, label: value })),
  ...options.value.map((option) => ({
    value: option.value,
    label: option.label,
    hint: option.hint,
  })),
]);

function pick(value: string) {
  emit('update:modelValue', value === '' ? undefined : value);
}

// Colors.
const open = ref(false);
const color = computed(() => splitColorRef(props.modelValue));
const swatch = computed(() => colorRefCss(props.theme, props.modelValue ?? props.inherited));
const selectedLabel = computed(() => {
  if (!props.modelValue) return props.inherited ? `Inherit` : 'Theme default';
  const option = options.value.find((entry) => entry.value === color.value.ref);
  const name = option?.label ?? props.modelValue;
  return color.value.alpha < 100 ? `${name} ${color.value.alpha}%` : name;
});
const roleOptions = computed(() => options.value.filter((option) => !option.hint));
const paletteOptions = computed(() => options.value.filter((option) => option.hint));

function pickColor(ref: string) {
  emit(
    'update:modelValue',
    joinColorRef(ref, color.value.ref ? color.value.alpha : 100) || undefined,
  );
}

function setAlpha(event: Event) {
  if (!color.value.ref) return;
  emit(
    'update:modelValue',
    joinColorRef(color.value.ref, Number((event.target as HTMLInputElement).value)),
  );
}
</script>

<template>
  <Popover v-if="group === 'color'" v-model:open="open" class="ws:w-72 ws:space-y-3 ws:p-3">
    <template #trigger>
      <button
        :id="id"
        type="button"
        class="mb-control ws:flex ws:w-full ws:items-center ws:gap-2 ws:text-left"
        :aria-label="ariaLabel"
        :disabled="disabled"
      >
        <span
          class="ws:h-4 ws:w-4 ws:shrink-0 ws:rounded-pill ws:border ws:border-surface-300 ws:dark:border-surface-600"
          :style="{ background: swatch ?? 'transparent' }"
          aria-hidden="true"
        />
        <span class="ws:min-w-0 ws:flex-1 ws:truncate" :class="modelValue ? '' : 'ws:text-surface-400'">{{ selectedLabel }}</span>
        <Icon name="down" class="mb-icon ws:shrink-0 ws:text-surface-400" />
      </button>
    </template>
    <div>
      <p class="mb-eyebrow ws:mb-1.5">Roles</p>
      <div class="ws:grid ws:grid-cols-8 ws:gap-1.5">
        <button
          v-for="option in roleOptions"
          :key="option.value"
          type="button"
          class="ws:h-7 ws:rounded-control ws:border ws:border-surface-300 ws:outline-offset-2 ws:dark:border-surface-600"
          :class="color.ref === option.value ? 'ws:outline-2 ws:outline-brand-500' : ''"
          :style="{ background: option.swatch ?? 'transparent' }"
          :title="option.label"
          :aria-label="option.label"
          :aria-pressed="color.ref === option.value"
          @click="pickColor(option.value)"
        />
      </div>
    </div>
    <div v-if="paletteOptions.length">
      <p class="mb-eyebrow ws:mb-1.5">Palette</p>
      <div class="ws:grid ws:grid-cols-8 ws:gap-1.5">
        <button
          v-for="option in paletteOptions"
          :key="option.value"
          type="button"
          class="ws:h-7 ws:rounded-control ws:border ws:border-surface-300 ws:outline-offset-2 ws:dark:border-surface-600"
          :class="color.ref === option.value ? 'ws:outline-2 ws:outline-brand-500' : ''"
          :style="{ background: option.swatch ?? 'transparent' }"
          :title="`${option.label} (${option.hint})`"
          :aria-label="option.label"
          :aria-pressed="color.ref === option.value"
          @click="pickColor(option.value)"
        />
      </div>
      <p class="ws:mt-1.5 ws:text-2xs ws:text-surface-500">Roles follow the theme, so prefer them over palette colors.</p>
    </div>
    <label v-if="alpha" class="ws:block">
      <span class="ws:flex ws:items-center ws:justify-between ws:text-xs ws:font-medium">
        Opacity
        <span class="ws:font-mono ws:text-2xs ws:text-surface-500 ws:tabular-nums">{{ color.alpha }}%</span>
      </span>
      <input
        type="range"
        class="mb-range"
        min="0"
        max="100"
        step="5"
        :value="color.alpha"
        :disabled="!color.ref"
        aria-label="Opacity"
        @input="setAlpha"
      />
    </label>
    <button type="button" class="mb-btn-ghost mb-btn-sm" :disabled="!modelValue" @click="emit('update:modelValue', undefined)">
      <Icon name="reset" class="mb-icon-sm" /> {{ inherited ? 'Inherit' : 'Use the theme default' }}
    </button>
  </Popover>

  <Select
    v-else
    :id="id"
    :model-value="modelValue ?? ''"
    :options="selectOptions"
    :aria-label="ariaLabel"
    :disabled="disabled"
    @update:model-value="pick"
  />
</template>
