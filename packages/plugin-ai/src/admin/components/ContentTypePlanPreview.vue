<script setup lang="ts">
import { Checkbox, Icon, typeIcon } from '@manablox/admin-sdk';
import {
  type ContentTypeKind,
  type ContentTypePlanType,
  fieldTypeReferences,
} from '@manablox/core';
import { computed } from 'vue';

/** Preview of a planned content model with per-type checkboxes; the parent dialog applies it. */
const props = defineProps<{
  types: ContentTypePlanType[];
  /** Existing types the plan refers to. */
  reused?: string[] | undefined;
  notes?: string | undefined;
  problems?: string[] | undefined;
  /** Ticked names; all when absent. */
  selected?: string[] | undefined;
  /** Hide the checkboxes; every type is included. */
  fixed?: boolean | undefined;
}>();
const emit = defineEmits<{ 'update:selected': [names: string[]] }>();

const ticked = computed(() => new Set(props.selected ?? props.types.map((type) => type.name)));

/** Types referenced by a ticked type, which cannot be unticked. */
const required = computed(() => {
  const needed = new Set<string>();
  for (const type of props.types) {
    if (!ticked.value.has(type.name)) continue;
    for (const field of type.fields) {
      for (const reference of fieldTypeReferences(field)) {
        if (reference.name !== type.name) needed.add(reference.name);
      }
    }
  }
  return needed;
});

function toggle(name: string, on: boolean) {
  const next = new Set(ticked.value);
  if (on) next.add(name);
  else next.delete(name);
  emit('update:selected', [...next]);
}

const KIND_LABELS: Record<ContentTypeKind, string> = {
  content: 'document type',
  data: 'databag type',
  block: 'block type',
};

const FIELD_LABELS: Record<string, string> = {
  string: 'Text',
  richtext: 'Rich text',
  number: 'Number',
  boolean: 'Switch',
  date: 'Date',
  select: 'Choice',
  link: 'Link',
  asset: 'Media',
  content: 'Relation',
  user: 'User',
  block: 'Block',
  blocks: 'Blocks',
  template: 'Template',
  databag: 'Databag',
};

function describe(field: ContentTypePlanType['fields'][number]): string {
  const references = fieldTypeReferences(field).map((reference) => reference.name);
  const kind = FIELD_LABELS[field.type] ?? field.type;
  return references.length ? `${kind}: ${references.join(', ')}` : kind;
}
</script>

<template>
  <div class="ai:space-y-3">
    <p v-if="notes" class="mb-callout ai:text-sm">{{ notes }}</p>

    <ul class="ai:space-y-2">
      <li
        v-for="type in types"
        :key="type.name"
        class="ai:rounded-card ai:border ai:border-surface-200 ai:p-3 ai:dark:border-surface-800"
        :class="ticked.has(type.name) ? '' : 'ai:opacity-60'"
      >
        <label class="ai:flex ai:items-start ai:gap-3">
          <Checkbox
            v-if="!fixed"
            class="ai:mt-1"
            :model-value="ticked.has(type.name)"
            :disabled="required.has(type.name) && ticked.has(type.name)"
            @update:model-value="toggle(type.name, $event)"
          />
          <span
            class="ai:flex ai:h-8 ai:w-8 ai:shrink-0 ai:items-center ai:justify-center ai:rounded-control"
            :class="type.kind === 'block' ? 'mb-tile-ochre' : 'mb-tile-clay'"
          >
            <Icon :name="typeIcon(type)" />
          </span>
          <span class="ai:min-w-0 ai:flex-1">
            <span class="ai:flex ai:flex-wrap ai:items-center ai:gap-2">
              <span class="ai:font-semibold">{{ type.label || type.name }}</span>
              <span class="ai:font-mono mb-meta">{{ type.name }}</span>
              <span class="mb-badge">{{ KIND_LABELS[type.kind] }}</span>
              <span v-if="required.has(type.name) && ticked.has(type.name)" class="ai:text-2xs ai:text-surface-500">
                needed by another type
              </span>
            </span>
            <span v-if="type.description" class="ai:mt-0.5 ai:block mb-meta">{{ type.description }}</span>
          </span>
        </label>
        <ul
          v-if="type.fields.length"
          class="ai:mt-2 ai:grid ai:gap-x-4 ai:gap-y-1 ai:text-xs ai:sm:grid-cols-2"
          :class="fixed ? 'ai:pl-11' : 'ai:pl-[4.25rem]'"
        >
          <li v-for="field in type.fields" :key="field.name" class="ai:flex ai:min-w-0 ai:gap-2">
            <span class="ai:truncate ai:font-medium">{{ field.label || field.name }}</span>
            <span class="ai:truncate ai:text-surface-500">
              {{ describe(field) }}{{ field.required ? ', required' : '' }}{{ field.localized ? ', translated' : '' }}
            </span>
          </li>
        </ul>
        <p v-else class="ai:mt-2 mb-meta" :class="fixed ? 'ai:pl-11' : 'ai:pl-[4.25rem]'">
          No fields of its own.
        </p>
      </li>
    </ul>

    <p v-if="reused?.length" class="mb-meta">
      Uses what the space already has: {{ reused.join(', ') }}.
    </p>
    <details v-if="problems?.length" class="mb-meta">
      <summary class="ai:cursor-pointer">
        {{ problems.length }} {{ problems.length === 1 ? 'part was' : 'parts were' }} left out
      </summary>
      <ul class="ai:mt-1 ai:list-disc ai:space-y-0.5 ai:pl-5">
        <li v-for="problem in problems" :key="problem">{{ problem }}</li>
      </ul>
    </details>
  </div>
</template>
