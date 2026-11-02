<script setup lang="ts">
import {
  content,
  runWrite,
  SaveButton,
  TextField,
  TYPE_ICON_NAMES,
  useSpaceStore,
} from '@manablox/admin-sdk';
import type { BlockValue, ContentTypePlanType } from '@manablox/core';
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ai } from '../queries';
import { useDesignRun } from '../useDesignRun';
import ContentTypePlanPreview from './ContentTypePlanPreview.vue';
import DesignDialog from './DesignDialog.vue';

/**
 * Designs a template (and any missing block types) from a prompt. Rich text travels as
 * HTML and the server converts it.
 */
const props = defineProps<{ spaceId: string }>();
const emit = defineEmits<{ close: [] }>();
const router = useRouter();
const spaces = useSpaceStore();

const creating = ref(false);
const title = ref('');

const run = useDesignRun(async (input) => {
  const result = await ai.designTemplate({
    spaceId: props.spaceId,
    locale: spaces.locale,
    icons: TYPE_ICON_NAMES,
    ...input,
  });
  title.value = result.title || title.value;
  return {
    types: result.plan.types as ContentTypePlanType[],
    title: result.title,
    blocks: result.blocks as BlockValue[],
    grid: result.grid,
    newTypes: result.newTypes,
    notes: result.notes,
    problems: result.problems,
  };
});
const design = run.result;

/** Preview rows: type label plus the first text value. */
const rows = computed(() =>
  (design.value?.blocks ?? []).map((block) => {
    const newName = design.value?.newTypes[block.type];
    const planned = design.value?.types.find((type) => type.name === newName);
    const label = spaces.typeById(block.type)?.label ?? planned?.label ?? newName ?? 'Block';
    const first = Object.values(block.fields).find(
      (value): value is string => typeof value === 'string' && Boolean(value.trim()),
    );
    return {
      id: block.blockId,
      label,
      isNew: Boolean(newName),
      text:
        first
          ?.replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim() ?? '',
    };
  }),
);

async function create() {
  const templateType = spaces.templateType;
  const plan = design.value;
  if (!plan || !templateType || !title.value.trim()) return;
  await runWrite(
    async () => {
      if (plan.types.length) await ai.applyPlan({ spaceId: props.spaceId, types: plan.types });
      const created = await content.create({
        spaceId: props.spaceId,
        typeId: templateType.id,
        locale: spaces.locale,
        title: title.value.trim(),
        fields: {
          blocks: plan.grid ? { grid: plan.grid, blocks: plan.blocks } : { blocks: plan.blocks },
        },
      });
      emit('close');
      await router.push(`/templates/${created.id}`);
      return created;
    },
    { busy: creating, error: run.note, success: (created) => `Created "${created.title}"` },
  );
}
</script>

<template>
  <DesignDialog
    title="Describe a template"
    :space-id="spaceId"
    :run="run"
    label="What is the template for?"
    placeholder="A product launch page: a big opening, three benefits side by side, a comparison with the old model, customer quotes and a sign-up call to action."
    hint="It is laid out from the block types this space has; a section none of them fits gets a new block type, created with the template."
    :blocked="spaces.templateType ? null : 'The template type is missing from this installation.'"
    @close="emit('close')"
  >
    <template #result>
      <template v-if="design">
        <TextField v-model="title" label="Name" maxlength="500" />

        <div>
          <p class="mb-label">Blocks, in reading order</p>
          <ol class="mb-list-divided ai:rounded-card ai:border ai:border-surface-200 ai:text-sm ai:dark:border-surface-800">
            <li v-for="(row, index) in rows" :key="row.id" class="ai:flex ai:gap-3 ai:p-2">
              <span class="ai:w-5 ai:shrink-0 ai:text-right ai:text-surface-500">{{ index + 1 }}</span>
              <span class="ai:min-w-0 ai:flex-1">
                <span class="ai:font-medium">{{ row.label }}</span>
                <span v-if="row.isNew" class="mb-badge ai:ml-2">new</span>
                <span v-if="row.text" class="mb-meta ai:block ai:truncate">{{ row.text }}</span>
              </span>
            </li>
          </ol>
          <p class="mb-hint">Opens in the editor as a draft, to be rearranged and rewritten there.</p>
        </div>

        <div v-if="design.types.length">
          <p class="mb-label">New block types</p>
          <ContentTypePlanPreview :types="design.types" :notes="design.notes" :problems="design.problems" fixed />
        </div>
        <p v-else-if="design.notes" class="mb-callout ai:text-sm">{{ design.notes }}</p>
      </template>
    </template>
    <template #primary>
      <SaveButton
        :saving="creating"
        icon="plus"
        :disabled="!design || !title.trim() || run.busy.value"
        label="Create template"
        @click="create"
      />
    </template>
  </DesignDialog>
</template>
