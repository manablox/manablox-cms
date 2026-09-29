<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import FormField from '@manablox/admin-sdk/components/ui/FormField.vue';
import SegmentedControl from '@manablox/admin-sdk/components/ui/SegmentedControl.vue';
import { type AssetAdjustments, type AssetEffect, NEUTRAL_ADJUSTMENTS } from '@manablox/core';
import { computed } from 'vue';
import { COLOUR_EFFECTS, COLOUR_SLIDERS, isNeutralColour } from '../imageFilter';

/** The image editor's colour controls: adjustment sliders and one effect. */
const adjust = defineModel<Record<keyof AssetAdjustments, number>>('adjust', { required: true });
const effect = defineModel<AssetEffect>('effect', { required: true });

const isNeutral = computed(() => isNeutralColour(adjust.value, effect.value));

function setAdjust(key: keyof AssetAdjustments, event: Event) {
  adjust.value = { ...adjust.value, [key]: Number((event.target as HTMLInputElement).value) };
}

function reset() {
  adjust.value = { ...NEUTRAL_ADJUSTMENTS };
  effect.value = 'none';
}
</script>

<template>
  <div class="space-y-3">
    <FormField v-for="slider in COLOUR_SLIDERS" :key="slider.key" :label="slider.label">
      <template #actions>
        <span class="font-mono text-2xs text-surface-500 tabular-nums">
          {{ slider.key === 'hue' ? `${adjust.hue}°` : adjust[slider.key].toFixed(2) }}
        </span>
      </template>
      <template #default="{ id }">
        <input
          :id="id"
          type="range"
          class="mb-range"
          :min="slider.min"
          :max="slider.max"
          :step="slider.step"
          :value="adjust[slider.key]"
          @input="setAdjust(slider.key, $event)"
        />
      </template>
    </FormField>
    <div>
      <span id="effect-label" class="mb-label">Effect</span>
      <SegmentedControl v-model="effect" :options="COLOUR_EFFECTS" :columns="4" labelledby="effect-label" />
    </div>
    <button type="button" class="mb-btn-ghost mb-btn-sm" :disabled="isNeutral" @click="reset">
      <Icon name="reset" class="mb-icon-sm" /> Leave the colour alone
    </button>
  </div>
</template>
