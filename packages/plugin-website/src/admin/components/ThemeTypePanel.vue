<script setup lang="ts">
import { NumberField, Select } from '@manablox/admin-sdk';
import {
  type HeadingLevel,
  type TextDefaults,
  type ThemeDesign,
  TYPE_STEPS,
  type TypeScaleEntry,
  type TypeStep,
} from '@manablox/site';
import SizeInput from './SizeInput.vue';
import TokenPicker from './TokenPicker.vue';

/** The type scale, heading levels and body text. */
const props = defineProps<{ theme: ThemeDesign; readOnly?: boolean }>();
const emit = defineEmits<{ update: [theme: ThemeDesign, group?: string] }>();

const LEVELS: HeadingLevel[] = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
const STEP_OPTIONS = TYPE_STEPS.map((step) => ({ value: step, label: step }));
const FONT_OPTIONS = [
  { value: 'heading' as const, label: 'Heading font' },
  { value: 'body' as const, label: 'Body font' },
  { value: 'mono' as const, label: 'Monospace' },
];
const WEIGHT_OPTIONS = [100, 200, 300, 400, 500, 600, 700, 800, 900].map((weight) => ({
  value: weight,
  label: String(weight),
}));
const TRANSFORM_OPTIONS = [
  { value: '', label: 'As typed' },
  { value: 'uppercase', label: 'Uppercase' },
  { value: 'lowercase', label: 'Lowercase' },
  { value: 'capitalize', label: 'Capitalize' },
];

/** Partial, with `undefined` clearing a key. */
type Patch<T> = { [K in keyof T]?: T[K] | undefined };

function setStep(step: TypeStep, patch: Patch<TypeScaleEntry>) {
  const current = props.theme.type[step];
  const next = { ...current, ...patch } as TypeScaleEntry & Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) if (value === undefined) delete next[key];
  emit(
    'update',
    { ...props.theme, type: { ...props.theme.type, [step]: next } },
    `type:${step}:${Object.keys(patch)[0]}`,
  );
}

function setText(target: HeadingLevel | 'body', patch: Patch<TextDefaults>) {
  const current = target === 'body' ? props.theme.body : props.theme.headings[target];
  const next = { ...current, ...patch } as TextDefaults & Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) if (value === undefined) delete next[key];
  emit(
    'update',
    target === 'body'
      ? { ...props.theme, body: next }
      : { ...props.theme, headings: { ...props.theme.headings, [target]: next } },
  );
}
</script>

<template>
  <div class="ws:space-y-6">
    <section class="ws:space-y-3">
      <h3 class="ws:text-sm ws:font-bold">Type scale</h3>
      <p class="mb-meta">Every text on the site uses one of these sizes. Mobile sizes apply below 640px.</p>
      <div class="ws:overflow-x-auto">
        <table class="ws:w-full ws:text-xs">
          <thead>
            <tr class="ws:text-left ws:text-surface-500">
              <th class="ws:py-1 ws:pr-2 ws:font-medium">Step</th>
              <th class="ws:py-1 ws:pr-2 ws:font-medium">Size</th>
              <th class="ws:py-1 ws:pr-2 ws:font-medium">Mobile</th>
              <th class="ws:py-1 ws:pr-2 ws:font-medium">Line</th>
              <th class="ws:py-1 ws:pr-2 ws:font-medium">Weight</th>
              <th class="ws:py-1 ws:font-medium">Tracking</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="step in TYPE_STEPS" :key="step" class="ws:align-top">
              <td class="ws:py-1 ws:pr-2 ws:font-mono ws:font-semibold">{{ step }}</td>
              <td class="ws:w-24 ws:py-1 ws:pr-2">
                <SizeInput :model-value="theme.type[step].size" :disabled="readOnly" @update:model-value="$event && setStep(step, { size: $event })" />
              </td>
              <td class="ws:w-24 ws:py-1 ws:pr-2">
                <SizeInput :model-value="theme.type[step].mobileSize" :placeholder="theme.type[step].size" :disabled="readOnly" @update:model-value="setStep(step, { mobileSize: $event })" />
              </td>
              <td class="ws:w-16 ws:py-1 ws:pr-2">
                <NumberField
                  :model-value="theme.type[step].lineHeight"
                  mode="decimal"
                  :min="0.8"
                  :max="3"
                  :step="0.05"
                  class="mb-input-mono"
                  :aria-label="`Line height of ${step}`"
                  :disabled="readOnly"
                  @update:model-value="$event && setStep(step, { lineHeight: $event })"
                />
              </td>
              <td class="ws:w-20 ws:py-1 ws:pr-2">
                <Select
                  :model-value="theme.type[step].weight"
                  :options="WEIGHT_OPTIONS"
                  :aria-label="`Weight of ${step}`"
                  :disabled="readOnly"
                  @update:model-value="setStep(step, { weight: $event })"
                />
              </td>
              <td class="ws:w-24 ws:py-1">
                <SizeInput :model-value="theme.type[step].letterSpacing" placeholder="normal" :disabled="readOnly" @update:model-value="setStep(step, { letterSpacing: $event })" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="ws:space-y-3">
      <h3 class="ws:text-sm ws:font-bold">Headings and body text</h3>
      <div v-for="target in [...LEVELS, 'body' as const]" :key="target" class="ws:grid ws:grid-cols-[3rem_minmax(0,1fr)] ws:items-start ws:gap-2">
        <span class="ws:pt-2 ws:font-mono ws:text-xs ws:font-semibold">{{ target }}</span>
        <div class="ws:grid ws:grid-cols-2 ws:gap-2">
          <Select
            :model-value="(target === 'body' ? theme.body : theme.headings[target]).type"
            :options="STEP_OPTIONS"
            :aria-label="`Size of ${target}`"
            :disabled="readOnly"
            @update:model-value="setText(target, { type: $event })"
          />
          <Select
            :model-value="(target === 'body' ? theme.body : theme.headings[target]).font"
            :options="FONT_OPTIONS"
            :aria-label="`Font of ${target}`"
            :disabled="readOnly"
            @update:model-value="setText(target, { font: $event })"
          />
          <TokenPicker
            :model-value="(target === 'body' ? theme.body : theme.headings[target]).color"
            group="color"
            :theme="theme"
            :aria-label="`Color of ${target}`"
            :disabled="readOnly"
            @update:model-value="setText(target, { color: $event as TextDefaults['color'] })"
          />
          <Select
            :model-value="(target === 'body' ? theme.body : theme.headings[target]).textTransform ?? ''"
            :options="TRANSFORM_OPTIONS"
            :aria-label="`Case of ${target}`"
            :disabled="readOnly"
            @update:model-value="setText(target, { textTransform: ($event || undefined) as TextDefaults['textTransform'] })"
          />
        </div>
      </div>
    </section>
  </div>
</template>
