<script setup lang="ts">
import { runWrite, SaveButton, SegmentedControl, TYPE_ICON_NAMES } from '@manablox/admin-sdk';
import type { ContentTypePlanType } from '@manablox/core';
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ai } from '../queries';
import { useDesignRun } from '../useDesignRun';
import ContentTypePlanPreview from './ContentTypePlanPreview.vue';
import DesignDialog from './DesignDialog.vue';

/** Designs content types from a prompt; ticked types are created on Create. */
const props = withDefaults(
  defineProps<{
    spaceId: string;
    /** Where the design starts; the dialog can change it. */
    scope?: 'any' | 'content' | 'block';
  }>(),
  { scope: 'any' },
);
const emit = defineEmits<{ close: [] }>();
const router = useRouter();

type Scope = 'any' | 'content' | 'block';
/** What the model designs; the list page opens it for the whole model. */
const scope = ref<Scope>(props.scope);
const SCOPES = [
  { value: 'any' as const, label: 'Anything', icon: 'blocks' },
  { value: 'content' as const, label: 'Document types', icon: 'doc' },
  { value: 'block' as const, label: 'Block types', icon: 'blocks' },
];

const creating = ref(false);
const selected = ref<string[]>([]);

const run = useDesignRun(async (input) => {
  const result = await ai.designTypes({
    spaceId: props.spaceId,
    scope: scope.value,
    icons: TYPE_ICON_NAMES,
    ...input,
  });
  const types = result.plan.types as ContentTypePlanType[];
  selected.value = types.map((type) => type.name);
  return { types, reused: result.reused, notes: result.notes, problems: result.problems };
});
const design = run.result;

const HEADINGS = {
  block: 'Describe a block type',
  content: 'Describe a document type',
  any: 'Describe a content model',
};
const heading = computed(() => HEADINGS[scope.value]);
const placeholder = computed(() =>
  scope.value === 'block'
    ? 'A pricing table: three plans side by side, each with a name, a price, a list of features and a button.'
    : 'A recipe: a short intro, ingredients with amounts, numbered steps with an optional photo each, cooking time, difficulty and the cuisine it belongs to.',
);

async function create() {
  const plan = design.value;
  if (!plan || !selected.value.length) return;
  await runWrite(
    async () => {
      const types = plan.types.filter((type) => selected.value.includes(type.name));
      const created = await ai.applyPlan({ spaceId: props.spaceId, types });
      emit('close');
      // Open the type matching the scope, else the first.
      const main =
        created.find((type) => type.kind === (scope.value === 'block' ? 'block' : 'content')) ??
        created[0];
      if (main)
        await router.push(`${main.kind === 'data' ? '/databag-types' : '/types'}/${main.id}`);
      return created;
    },
    {
      busy: creating,
      error: run.note,
      success: (created) =>
        created.length === 1 ? `Created "${created[0]?.label}"` : `Created ${created.length} types`,
    },
  );
}
</script>

<template>
  <DesignDialog
    :title="heading"
    :space-id="spaceId"
    :run="run"
    label="What should it hold?"
    prompt-class="ai:min-h-32"
    :placeholder="placeholder"
    hint="Say what editors will write and what a page is made of; the model picks the field types and reuses the types this space already has."
    @close="emit('close')"
  >
    <template #options>
      <SegmentedControl v-model="scope" :options="SCOPES" :columns="3" aria-label="What to design" />
    </template>
    <template #result>
      <ContentTypePlanPreview
        v-if="design"
        v-model:selected="selected"
        :types="design.types"
        :reused="design.reused"
        :notes="design.notes"
        :problems="design.problems"
      />
    </template>
    <template #primary>
      <SaveButton
        :saving="creating"
        icon="plus"
        :disabled="!design || !selected.length || run.busy.value"
        :label="`Create ${selected.length === 1 ? 'type' : `${selected.length} types`}`"
        @click="create"
      />
    </template>
  </DesignDialog>
</template>
