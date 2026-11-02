<script setup lang="ts">
import type { AdminSlotProps } from '@manablox/admin-plugin';
import { htmlToRichText, invalidate } from '@manablox/admin-sdk';
import { computed } from 'vue';
import { AI_TEXT_FIELD_TYPES } from '../../sdk';
import AiWandButton from '../components/AiWandButton.vue';
import { documentContext } from '../model/context';

/** Wands beside a field's label: text for text fields, images and videos for asset fields. */
const props = defineProps<AdminSlotProps['field.actions']>();

const isText = computed(() => AI_TEXT_FIELD_TYPES.includes(props.field.type));

const modelContext = computed(() => {
  const around = documentContext(props.context);
  if (!isText.value) {
    return {
      fieldLabel: props.field.label,
      fieldType: 'asset',
      locale: props.context.locale,
      contentTypeLabel: around.contentTypeLabel,
      documentTitle: around.documentTitle,
    };
  }
  const settings = props.field.settings as { max?: number; maxLength?: number };
  return {
    fieldLabel: props.field.label,
    fieldType: props.field.type,
    locale: props.context.locale,
    maxLength: settings.max ?? settings.maxLength ?? null,
    ...around,
  };
});

/** `accept` decides which asset wands show; unrestricted shows both. */
const accept = computed(() => (props.field.settings.accept as string[] | undefined) ?? []);
const takes = (family: string) =>
  !accept.value.length || accept.value.some((entry) => entry.startsWith(family));

/** Rich text arrives as HTML and is parsed into a document. */
async function applyText(text: string) {
  props.update(props.field.type === 'richtext' ? await htmlToRichText(text) : text);
}

/** The generated asset is new in the library; a list field gets it added. */
function applyAsset(assetId: string) {
  invalidate.assets(props.context.spaceId);
  if (props.field.settings.multiple !== true) {
    props.update(assetId);
    return;
  }
  const ids = Array.isArray(props.value) ? (props.value as string[]) : [];
  props.update(ids.includes(assetId) ? ids : [...ids, assetId]);
}
</script>

<template>
  <AiWandButton
    v-if="isText"
    capability="text"
    :context="modelContext"
    :label="`Write ${field.label} with AI`"
    @text="applyText"
  />
  <template v-else>
    <AiWandButton
      v-if="takes('image')"
      capability="image"
      :context="modelContext"
      label="Generate an image"
      @asset="applyAsset"
    />
    <AiWandButton
      v-if="takes('video')"
      capability="video"
      :context="modelContext"
      label="Generate a video"
      @asset="applyAsset"
    />
  </template>
</template>
