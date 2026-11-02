<script setup lang="ts">
import { FeatureLock, type FeatureState, Icon, useFeature } from '@manablox/admin-sdk';
import type { FeatureKey } from '@manablox/core';
import { computed, ref } from 'vue';
import type { AiCapability } from '../../sdk';
import { AI_FEATURE, AI_IMAGES, AI_VIDEO } from '../model/features';
import { useWand } from '../useWand';
import AiGenerateDialog from './AiGenerateDialog.vue';

/** AI wand button and dialog; renders only when the space supports the capability. */
const props = withDefaults(
  defineProps<{
    capability: Extract<AiCapability, 'text' | 'image' | 'video'>;
    /** Passed to the model as context. */
    context?: Record<string, unknown> | undefined;
    label?: string | undefined;
    /** `icon`: square button; `button`: labelled. */
    variant?: 'icon' | 'button';
    disabled?: boolean;
  }>(),
  { variant: 'icon', disabled: false },
);

const emit = defineEmits<{ text: [value: string]; asset: [assetId: string] }>();

const { enabled, kinds, spaceId } = useWand(props.capability);
const open = ref(false);

// Media generation needs the plugin and its own feature.
const ai = useFeature(AI_FEATURE);
const mediaKey = computed(() => (props.capability === 'video' ? AI_VIDEO : AI_IMAGES));
const media = useFeature(() => mediaKey.value);
const off = computed<{ key: FeatureKey; state: FeatureState } | null>(() => {
  if (!ai.value.enabled) return { key: AI_FEATURE, state: ai.value };
  if (props.capability === 'text' || media.value.enabled) return null;
  return { key: mediaKey.value, state: media.value };
});
const buttonClass = computed(() =>
  props.variant === 'icon'
    ? 'mb-btn-ghost mb-btn-icon mb-btn-sm ai:text-brand-600 ai:dark:text-brand-300'
    : 'mb-btn-outline',
);
</script>

<template>
  <FeatureLock
    v-if="enabled && !disabled && off?.state.locked"
    :feature="off.key"
    :state="off.state"
    :label="variant === 'button' ? (label ?? 'Generate') : undefined"
    :trigger-class="buttonClass"
  />
  <button
    v-else-if="enabled && !disabled && !off"
    type="button"
    :class="buttonClass"
    :title="label ?? 'Generate with AI'"
    :aria-label="label ?? 'Generate with AI'"
    @click="open = true"
  >
    <Icon name="wand" />
    <span v-if="variant === 'button'">{{ label ?? 'Generate' }}</span>
  </button>

  <AiGenerateDialog
    v-if="open && spaceId"
    :space-id="spaceId"
    :capability="capability"
    :context="context"
    :title="label"
    :provider-kinds="kinds"
    @close="open = false"
    @text="emit('text', $event)"
    @asset="emit('asset', $event)"
  />
</template>
