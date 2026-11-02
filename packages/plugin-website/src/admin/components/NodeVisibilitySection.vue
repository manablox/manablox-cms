<script setup lang="ts">
import { BREAKPOINTS, ChipToggle, FormField, Select } from '@manablox/admin-sdk';
import type { BlockBreakpoint } from '@manablox/core';
import type { DesignNode, NodeVisibility } from '@manablox/site';
import { computed } from 'vue';
import { bindingOptions } from '../model/bindings';
import { useDesignerContext } from '../useDesignerContext';

/** The Visibility tab: where a node shows, and hiding it while a field is empty. */
const props = defineProps<{ node: DesignNode }>();
const emit = defineEmits<{ update: [node: DesignNode] }>();

const { fields, repeats, readOnly } = useDesignerContext();

const shownAt = computed<BlockBreakpoint[]>(
  () => props.node.visibility?.breakpoints ?? BREAKPOINTS.map((entry) => entry.value),
);

function write(visibility: {
  breakpoints?: BlockBreakpoint[] | undefined;
  whenField?: string | undefined;
}) {
  if (readOnly.value) return;
  const next: DesignNode = { ...props.node };
  const clean: NodeVisibility = {};
  if (visibility.breakpoints) clean.breakpoints = visibility.breakpoints;
  if (visibility.whenField) clean.whenField = visibility.whenField;
  if (Object.keys(clean).length) next.visibility = clean;
  else delete next.visibility;
  emit('update', next);
}

function toggle(breakpoint: BlockBreakpoint, on: boolean) {
  const set = new Set(shownAt.value);
  if (on) set.add(breakpoint);
  else set.delete(breakpoint);
  const list = BREAKPOINTS.map((entry) => entry.value).filter((entry) => set.has(entry));
  write({
    ...props.node.visibility,
    breakpoints: list.length === BREAKPOINTS.length ? undefined : list,
  });
}

const whenChoices = computed(() => [
  { value: '', label: 'Always shown' },
  ...bindingOptions(fields.value, null, repeats.value).map((option) => ({
    value: option.value,
    label: `Hidden while "${option.label}" is empty`,
  })),
]);
</script>

<template>
  <div class="ws:space-y-4">
    <div>
      <p class="mb-label">Shown on</p>
      <div class="ws:flex ws:flex-wrap ws:gap-1.5">
        <ChipToggle
          v-for="entry in BREAKPOINTS"
          :key="entry.value"
          :model-value="shownAt.includes(entry.value)"
          :disabled="readOnly"
          @update:model-value="toggle(entry.value, $event)"
        >
          {{ entry.label }}
        </ChipToggle>
      </div>
      <p v-if="shownAt.length === 0" class="mb-error">Hidden everywhere: turn on at least one screen size.</p>
      <p v-else class="mb-hint">Turned off sizes hide this element and everything in it.</p>
    </div>
    <FormField label="Hide when empty" hint="Hides this element while the chosen field has no value.">
      <template #default="{ id }">
        <Select
          :id="id"
          :model-value="node.visibility?.whenField ?? ''"
          :options="whenChoices"
          :disabled="readOnly"
          @update:model-value="write({ ...node.visibility, whenField: $event || undefined })"
        />
      </template>
    </FormField>
  </div>
</template>
