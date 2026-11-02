<script setup lang="ts">
import type { AdminSlotProps } from '@manablox/admin-plugin';
import {
  Checkbox,
  FormField,
  runWrite,
  Select,
  TextareaField,
  TYPE_ICON_NAMES,
  useSessionStore,
  useSpaceStore,
} from '@manablox/admin-sdk';
import type { ContentTypePlanType } from '@manablox/core';
import { computed, ref, watch } from 'vue';
import ContentTypePlanPreview from '../components/ContentTypePlanPreview.vue';
import DesignButton from '../components/DesignButton.vue';
import { type SpaceDesignDraft, spaceDesignDraft } from '../model/space-starter';
import { ai, useAiAvailable } from '../queries';

/** "Describe it" in the space creation form: AI designs the types through an existing space's providers. */
const props = defineProps<AdminSlotProps['space.create.starters']>();

const store = useSpaceStore();
const session = useSessionStore();
const draft = computed(() => spaceDesignDraft(props.draft));
const set = (patch: Partial<SpaceDesignDraft>) => props.setDraft(patch);

/** Spaces whose providers may design it, the current one first by default. */
const aiSpaces = computed(() => store.spaces.filter((space) => session.can('ai:use', space.id)));
watch(
  aiSpaces,
  (list) => {
    const source = draft.value.source ?? store.currentId;
    if (!list.some((space) => space.id === source)) set({ source: list[0]?.id ?? null });
    else if (draft.value.source === undefined) set({ source });
  },
  { immediate: true },
);
const source = computed({
  get: () => draft.value.source ?? '',
  set: (value: string) => set({ source: value || null }),
});

const available = useAiAvailable(() => draft.value.source ?? null);
const sourceCanWrite = computed(() => (available.data.value?.text ?? []).length > 0);
const canCopy = computed(() => session.can('ai:configure', draft.value.source ?? null));
watch(canCopy, (can) => set({ canCopy: can }), { immediate: true });

const description = computed({
  get: () => draft.value.description,
  set: (value: string) => set({ description: value }),
});
const copyProviders = computed({
  get: () => draft.value.copyProviders,
  set: (value: boolean) => set({ copyProviders: value }),
});
const selected = computed({
  get: () => draft.value.selected,
  set: (value: string[]) => set({ selected: value }),
});

const designing = ref(false);
const error = ref<string | null>(null);

async function designIt() {
  const spaceId = draft.value.source;
  const prompt = draft.value.description.trim();
  if (!spaceId || !prompt) return;
  await runWrite(
    async () => {
      const result = await ai.designTypes({
        spaceId,
        prompt,
        scope: 'any',
        forNewSpace: true,
        icons: TYPE_ICON_NAMES,
      });
      const types = result.plan.types as ContentTypePlanType[];
      set({
        design: { types, notes: result.notes, problems: result.problems },
        selected: types.map((type) => type.name),
      });
    },
    { error, busy: designing },
  );
}
</script>

<template>
  <div class="ai:space-y-3">
    <div class="ai:grid ai:gap-3 ai:sm:grid-cols-2">
      <div>
        <FormField label="Designed with the AI of" v-slot="{ id }">
          <Select :id="id" v-model="source" :options="aiSpaces.map((space) => ({ value: space.id, label: space.name }))" />
        </FormField>
        <p v-if="draft.source && available.data.value && !sourceCanWrite" class="mb-error">
          That space has no provider that writes text.
        </p>
      </div>
      <Checkbox v-if="canCopy" v-model="copyProviders" class="ai:self-end ai:pb-2">Give the new space the same AI providers</Checkbox>
    </div>
    <TextareaField
      v-model="description"
      label="What will the space hold?"
      class="ai:min-h-28"
      placeholder="A website for a mountain hut: landing pages built from sections, news posts, a menu card with dishes and prices, room types with photos and rates, and events with dates."
      maxlength="12000"
    />
    <DesignButton
      :busy="designing"
      :disabled="!draft.description.trim() || !sourceCanWrite"
      :label="draft.design ? 'Design again' : 'Design the structure'"
      @click="designIt"
    />
    <p v-if="error" class="mb-error">{{ error }}</p>
    <ContentTypePlanPreview
      v-if="draft.design"
      v-model:selected="selected"
      :types="draft.design.types"
      :notes="draft.design.notes"
      :problems="draft.design.problems"
    />
  </div>
</template>
