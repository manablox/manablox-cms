<script setup lang="ts">
import { Icon, NumberField, SaveButton, TextField, toast, useDraftForm } from '@manablox/admin-sdk';
import { technicalName } from '@manablox/core';
import { computed, ref, watch } from 'vue';
import { AI_DEFAULT_LENGTHS, AI_LENGTH_LIMITS, type AiLengthPreset } from '../../sdk';
import { aiProviders, useAiSettings } from '../queries';

/** The space's length presets: words per field, words per document, and block count. */
const props = defineProps<{ spaceId: string; canConfigure: boolean }>();

const query = useAiSettings(() => props.spaceId);
const form = useDraftForm<Record<string, never>>();
const { saving } = form;

type Row = Pick<AiLengthPreset, 'id' | 'label'> & {
  fieldWords: number | null;
  documentWords: number | null;
  blocks: number | null;
};
const rows = ref<Row[]>([]);

watch(
  () => query.data.value?.lengths,
  (lengths) => {
    rows.value = (lengths ?? AI_DEFAULT_LENGTHS).map((preset) => ({ ...preset }));
  },
  { immediate: true },
);

const canAdd = computed(() => rows.value.length < AI_LENGTH_LIMITS.presets);

function add() {
  const taken = new Set(rows.value.map((row) => row.id));
  let n = rows.value.length + 1;
  while (taken.has(`length_${n}`)) n++;
  rows.value.push({
    id: `length_${n}`,
    label: 'New length',
    fieldWords: 120,
    documentWords: 1000,
    blocks: null,
  });
}

/** Ids follow the label on save, except for existing presets. */
function idFor(row: Row, index: number): string {
  if (!row.id.startsWith('length_')) return row.id;
  return technicalName(row.label, { final: true }) || `length_${index + 1}`;
}

async function submit() {
  await form.submit(async () => {
    const seen = new Set<string>();
    const lengths = rows.value.map((row, index) => {
      let id = idFor(row, index);
      while (seen.has(id)) id = `${id}_${index + 1}`;
      seen.add(id);
      return {
        id,
        label: row.label.trim() || id,
        fieldWords: Math.max(1, Math.round(row.fieldWords || 1)),
        documentWords: Math.max(1, Math.round(row.documentWords || 1)),
        blocks: row.blocks && row.blocks > 0 ? Math.round(row.blocks) : null,
      };
    });
    await aiProviders.saveSettings({ spaceId: props.spaceId, lengths });
    toast.success('Lengths saved');
  });
}

function reset() {
  rows.value = AI_DEFAULT_LENGTHS.map((preset) => ({ ...preset }));
}
</script>

<template>
  <div>
    <p class="mb-hint ai:mb-3">
      The choices in the Length picker when generating. A field is written to its word count;
      a whole document to its own, spread over its fields and blocks.
    </p>
    <div class="ai:overflow-x-auto">
      <table class="ai:w-full ai:min-w-[34rem] ai:text-sm">
        <thead>
          <tr class="ai:text-left mb-meta">
            <th class="ai:pb-2 ai:font-medium">Name</th>
            <th class="ai:pb-2 ai:font-medium">Words in a field</th>
            <th class="ai:pb-2 ai:font-medium">Words in a document</th>
            <th class="ai:pb-2 ai:font-medium">Blocks</th>
            <th class="ai:w-8" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in rows" :key="index" class="ai:align-top">
            <td class="ai:py-1 ai:pr-2">
              <TextField
                :model-value="row.label"
                maxlength="60"
                :aria-label="`Name of length ${index + 1}`"
                :disabled="!canConfigure"
                @update:model-value="row.label = String($event ?? '')"
              />
            </td>
            <td class="ai:py-1 ai:pr-2">
              <NumberField v-model="row.fieldWords" nullable :min="1" :max="AI_LENGTH_LIMITS.words" :aria-label="`Words in a field, ${row.label}`" :disabled="!canConfigure" />
            </td>
            <td class="ai:py-1 ai:pr-2">
              <NumberField v-model="row.documentWords" nullable :min="1" :max="AI_LENGTH_LIMITS.words" :aria-label="`Words in a document, ${row.label}`" :disabled="!canConfigure" />
            </td>
            <td class="ai:py-1 ai:pr-2">
              <NumberField v-model="row.blocks" nullable :min="1" :max="AI_LENGTH_LIMITS.blocks" placeholder="auto" :aria-label="`Blocks, ${row.label}`" :disabled="!canConfigure" />
            </td>
            <td class="ai:py-1">
              <button
                v-if="canConfigure && rows.length > 1"
                type="button"
                class="mb-btn-ghost-danger mb-btn-icon"
                :aria-label="`Remove ${row.label}`"
                :title="`Remove ${row.label}`"
                @click="rows.splice(index, 1)"
              >
                <Icon name="trash" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="canConfigure" class="ai:mt-4 ai:flex ai:flex-wrap ai:items-center ai:gap-2">
      <SaveButton :saving="saving" @click="submit" />
      <button v-if="canAdd" type="button" class="mb-btn-outline" @click="add">
        <Icon name="plus" /> Add a length
      </button>
      <button type="button" class="mb-btn-ghost ai:ml-auto" @click="reset">Back to the defaults</button>
    </div>
  </div>
</template>
