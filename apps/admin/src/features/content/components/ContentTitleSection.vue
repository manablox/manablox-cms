<script setup lang="ts">
import FormField from '@manablox/admin-sdk/components/ui/FormField.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { slugDraft } from '@manablox/core';
import { computed } from 'vue';
import { useDerivedName } from '~/composables/useDerivedName';
import { useDraftStore } from '../useDraftStore';

/** The open document's title and slug; a new document's slug follows the title. */
defineProps<{ canWrite: boolean; hasSlug: boolean }>();

const draft = useDraftStore();

/** New documents only: the slug follows the title while it still matches it. */
const slug = useDerivedName({
  read: () => draft.doc?.slug ?? '',
  write: (value) => {
    if (draft.doc) draft.doc.slug = value;
  },
  derive: slugDraft,
  follows: () => {
    const doc = draft.doc;
    if (!doc || doc.id) return false;
    return !doc.slug || doc.slug === slugDraft(doc.title);
  },
});

/** The title; typing it drags a slug that still follows it along. */
const titleModel = computed({
  get: () => draft.doc?.title ?? '',
  set: (value: string) => {
    if (!draft.doc) return;
    // Read before the title changes.
    const follow = slug.follows();
    draft.doc.title = value;
    if (follow) draft.doc.slug = slugDraft(value);
  },
});

/** Trims a trailing hyphen once the field is left. */
function onTitleBlur() {
  if (slug.follows()) slug.onNameBlur();
}
</script>

<template>
  <div v-if="draft.doc" class="mb-card space-y-4">
    <div :class="draft.errorFor(['title']) ? 'mb-invalid' : ''" :data-invalid="draft.errorFor(['title']) ? '' : undefined">
      <FormField label="Title" :error="draft.errorFor(['title'])">
        <template #default="{ id }">
          <input
            :id="id"
            v-model="titleModel"
            :readonly="!canWrite"
            class="mb-input mb-input-lg font-display text-xl font-bold"
            @blur="onTitleBlur"
          />
        </template>
      </FormField>
    </div>
    <div
      v-if="hasSlug"
      :class="draft.errorFor(['slug']) ? 'mb-invalid' : ''"
      :data-invalid="draft.errorFor(['slug']) ? '' : undefined"
    >
      <TextField
        v-model="draft.doc.slug"
        label="Slug"
        class="mb-input-mono"
        placeholder="derived from the title"
        :readonly="!canWrite"
        :error="draft.errorFor(['slug'])"
        @blur="draft.doc.slug = slugDraft(draft.doc.slug, { final: true })"
      />
    </div>
  </div>
</template>
