<script setup lang="ts">
import { confirm, DropdownMenu, FormField, Icon, Select, TextField } from '@manablox/admin-sdk';
import {
  BLOCK_PRESET_LABELS,
  BLOCK_PRESETS,
  type BlockDesign,
  type DesignSourceType,
} from '@manablox/site';
import { computed, ref } from 'vue';
import {
  addVariant,
  canAddVariant,
  duplicateVariant,
  newVariant,
  relabelVariant,
  removeVariant,
  type VariantStart,
  variantList,
  withVariantRoot,
} from '../model/variants';

/**
 * The variants of a block design: pick the one on the canvas, add (generated, from a preset
 * or empty), duplicate, rename, make default, delete. The default variant cannot be deleted.
 */
const props = defineProps<{
  design: BlockDesign;
  type: DesignSourceType;
  readOnly: boolean;
}>();
const current = defineModel<string>({ required: true });
const emit = defineEmits<{ update: [design: BlockDesign, group?: string] }>();

const list = computed(() => variantList(props.design));
const options = computed(() =>
  list.value.map((entry) => ({
    value: entry.name,
    label: entry.name === props.design.default ? `${entry.label} (default)` : entry.label,
  })),
);
const variant = computed(() => props.design.variants[current.value]);
const isDefault = computed(() => current.value === props.design.default);

const STARTS: ReadonlyArray<{ value: VariantStart; label: string }> = [
  { value: 'generated', label: 'From the fields' },
  ...BLOCK_PRESETS.map((preset) => ({ value: preset, label: BLOCK_PRESET_LABELS[preset] })),
  { value: 'blank', label: 'Empty' },
];

const adding = ref(false);
const replacing = ref(false);

function add(start: VariantStart) {
  const label =
    start === 'generated' || start === 'blank' ? 'New variant' : BLOCK_PRESET_LABELS[start];
  const result = addVariant(props.design, newVariant(props.design, props.type, start, label));
  emit('update', result.design);
  current.value = result.name;
}

async function replace(start: VariantStart) {
  const ok = await confirm({
    title: `Replace "${variant.value?.label}"?`,
    message:
      'Its elements are replaced with a new arrangement of the fields. Undo brings them back.',
    confirmLabel: 'Replace',
  });
  if (!ok) return;
  const fresh = newVariant(props.design, props.type, start, variant.value?.label ?? '');
  emit('update', withVariantRoot(props.design, current.value, fresh.root));
}

function duplicate() {
  const result = duplicateVariant(props.design, current.value);
  if (!result) return;
  emit('update', result.design);
  current.value = result.name;
}

function remove() {
  const next = removeVariant(props.design, current.value);
  if (!next) return;
  emit('update', next);
  current.value = next.default;
}

function makeDefault() {
  emit('update', { ...props.design, default: current.value });
}
</script>

<template>
  <div class="ws:space-y-2">
    <FormField label="Variant" hint="Editors pick a variant per block; the default is used otherwise.">
      <template #default="{ id }">
        <Select :id="id" v-model="current" :options="options" />
      </template>
    </FormField>
    <TextField
      v-if="variant"
      :model-value="variant.label"
      label="Variant name"
      :disabled="readOnly"
      @update:model-value="emit('update', relabelVariant(design, current, String($event ?? '')), `variant-label:${current}`)"
    />
    <div v-if="!readOnly" class="ws:flex ws:flex-wrap ws:gap-1">
      <DropdownMenu :open="adding" align="start" @update:open="adding = $event">
        <template #trigger>
          <button type="button" class="mb-btn-outline mb-btn-sm" :disabled="!canAddVariant(design)">
            <Icon name="plus" class="mb-icon-sm" /> Add
          </button>
        </template>
        <button v-for="start in STARTS" :key="start.value" type="button" class="mb-menu-item" @click="add(start.value)">
          {{ start.label }}
        </button>
      </DropdownMenu>
      <DropdownMenu :open="replacing" align="start" @update:open="replacing = $event">
        <template #trigger>
          <button type="button" class="mb-btn-ghost mb-btn-sm" title="Start this variant over from the fields or a preset">
            <Icon name="wand" class="mb-icon-sm" /> Start over
          </button>
        </template>
        <button v-for="start in STARTS" :key="start.value" type="button" class="mb-menu-item" @click="replace(start.value)">
          {{ start.label }}
        </button>
      </DropdownMenu>
      <button type="button" class="mb-btn-ghost mb-btn-sm" :disabled="!canAddVariant(design)" @click="duplicate">
        <Icon name="copy" class="mb-icon-sm" /> Duplicate
      </button>
      <button v-if="!isDefault" type="button" class="mb-btn-ghost mb-btn-sm" @click="makeDefault">
        <Icon name="star" class="mb-icon-sm" /> Make default
      </button>
      <button v-if="!isDefault" type="button" class="mb-btn-ghost-danger mb-btn-sm" @click="remove">
        <Icon name="trash" class="mb-icon-sm" /> Delete
      </button>
    </div>
  </div>
</template>
