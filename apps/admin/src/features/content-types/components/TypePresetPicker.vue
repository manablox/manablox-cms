<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import { computed } from 'vue';
import { KIND_ICONS, type TypeKind } from '../model';
import type { TypePreset } from '../presets';

/** Radio tiles for a new type's starting point: blank, or one of `presets`; the slot adds its options. */
const model = defineModel<string>({ required: true });
const props = defineProps<{ kind: TypeKind; presets: TypePreset[] }>();

const options = computed(() => [
  {
    id: 'blank',
    label: 'Blank',
    icon: KIND_ICONS[props.kind],
    hint: 'No fields; add your own.',
  },
  ...props.presets.map((preset) => ({
    id: preset.id,
    label: preset.label,
    icon: preset.icon,
    hint: preset.fields.map((field) => field.label).join(', '),
  })),
]);
</script>

<template>
  <section class="mb-card">
    <h2 id="type-preset-label" class="mb-3 text-sm font-bold">Start from</h2>
    <div role="radiogroup" aria-labelledby="type-preset-label" class="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      <!-- Buttons, not native radios, so a declined replace leaves the old one checked. -->
      <button
        v-for="option in options"
        :key="option.id"
        type="button"
        role="radio"
        :aria-checked="model === option.id"
        class="flex items-start gap-2.5 rounded-control border px-3 py-2 text-left text-sm transition focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none"
        :class="
          model === option.id
            ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-600/15'
            : 'border-surface-200 hover:border-surface-300 dark:border-surface-700 dark:hover:border-surface-600'
        "
        @click="model = option.id"
      >
        <Icon :name="option.icon" class="mt-0.5 mb-icon shrink-0 text-surface-500" />
        <span class="min-w-0">
          <span class="block font-medium">{{ option.label }}</span>
          <span class="block text-2xs text-surface-500">{{ option.hint }}</span>
        </span>
      </button>
    </div>
    <slot />
  </section>
</template>
