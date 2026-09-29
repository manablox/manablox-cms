<script setup lang="ts">
import ContentPicker from '@manablox/admin-sdk/components/ContentPicker.vue';
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import Checkbox from '@manablox/admin-sdk/components/ui/Checkbox.vue';
import FormField from '@manablox/admin-sdk/components/ui/FormField.vue';
import MimeTypePicker from '@manablox/admin-sdk/components/ui/MimeTypePicker.vue';
import NumberField from '@manablox/admin-sdk/components/ui/NumberField.vue';
import Select from '@manablox/admin-sdk/components/ui/Select.vue';
import { useMediaPresets } from '@manablox/admin-sdk/features/assets/queries';
import { useContentByIds } from '@manablox/admin-sdk/features/content/queries';
import type { FieldDefinition } from '@manablox/admin-sdk/features/content-types/queries';
import { computed } from 'vue';
import ImageSizeList from '~/features/content-types/components/ImageSizeList.vue';
import type { SettingSpec } from '~/features/content-types/field-setting-specs';

/** Renders one field-type setting by its `kind`; `FieldSettings` handles layout. */
const props = defineProps<{
  spec: SettingSpec;
  field: FieldDefinition;
  /** Id stem; a string for repeater sub-fields. */
  index: number | string;
  readOnly: boolean;
  candidateTypes: { id: string; label: string }[];
  candidateTemplates: { id: string; label: string }[];
  optionsText: string;
  acceptList: string[];
}>();
const emit = defineEmits<{
  set: [key: string, value: unknown];
  toggleType: [id: string];
  toggleTemplate: [id: string];
  'update:optionsText': [text: string];
  'update:acceptList': [list: string[]];
}>();

// Resolve a `document` setting's id to a title.
const chosenId = computed(() => {
  const value = props.field.settings[props.spec.key];
  return props.spec.kind === 'document' && typeof value === 'string' && value ? [value] : [];
});
const { data: chosen } = useContentByIds(chosenId);
const chosenTitle = computed(() => chosen.value?.[0]?.title ?? null);

const optionsModel = computed({
  get: () => props.optionsText,
  set: (text: string) => emit('update:optionsText', text),
});
/** A free-text setting; emptied means unset. */
const textModel = computed({
  get: () => String(props.field.settings[props.spec.key] ?? ''),
  set: (text: string) => emit('set', props.spec.key, text || undefined),
});

const { data: presets } = useMediaPresets();
const chosenPresets = computed(() =>
  Array.isArray(props.field.settings.presets) ? (props.field.settings.presets as string[]) : [],
);
function togglePreset(name: string) {
  const current = chosenPresets.value;
  emit(
    'set',
    'presets',
    current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name],
  );
}

/** Rich text tools in toolbar order. */
const TOOLS: { value: string; label: string }[] = [
  { value: 'bold', label: 'Bold' },
  { value: 'italic', label: 'Italic' },
  { value: 'strike', label: 'Strikethrough' },
  { value: 'code', label: 'Code' },
  { value: 'link', label: 'Link' },
  { value: 'heading', label: 'Heading' },
  { value: 'bulletList', label: 'Bulleted list' },
  { value: 'orderedList', label: 'Numbered list' },
  { value: 'blockquote', label: 'Quote' },
  { value: 'codeBlock', label: 'Code block' },
  { value: 'horizontalRule', label: 'Divider' },
  { value: 'alignLeft', label: 'Align left' },
  { value: 'alignCenter', label: 'Align centre' },
  { value: 'alignRight', label: 'Align right' },
];
const DEFAULT_TOOLS = ['bold', 'italic', 'link', 'heading', 'bulletList', 'orderedList'];

function toolbarOf(field: FieldDefinition): string[] {
  return Array.isArray(field.settings.toolbar)
    ? (field.settings.toolbar as string[])
    : DEFAULT_TOOLS;
}

function toggleTool(field: FieldDefinition, value: string) {
  const current = toolbarOf(field);
  const next = current.includes(value)
    ? current.filter((entry) => entry !== value)
    : TOOLS.map((tool) => tool.value).filter((entry) => entry === value || current.includes(entry));
  emit('set', 'toolbar', next);
}
</script>

<template>
  <Checkbox
    v-if="spec.kind === 'boolean'"
    class="py-1"
    :model-value="(field.settings[spec.key] ?? spec.default) === true"
    :disabled="readOnly"
    @update:model-value="emit('set', spec.key, $event)"
  >
    {{ spec.label }}
    <span v-if="spec.hint" class="mb-meta">{{ spec.hint }}</span>
  </Checkbox>

  <NumberField
    v-else-if="spec.kind === 'number'"
    :id="`field-${index}-${spec.key}`"
    :label="spec.label"
    :hint="spec.hint"
    mode="decimal"
    :model-value="typeof field.settings[spec.key] === 'number' ? (field.settings[spec.key] as number) : undefined"
    :disabled="readOnly"
    @update:model-value="emit('set', spec.key, $event)"
  />

  <FormField v-else :id="`field-${index}-${spec.key}`" :label="spec.label" v-slot="{ id }">
    <Select
      v-if="spec.kind === 'select'"
      :id="id"
      :model-value="String(field.settings[spec.key] ?? spec.default ?? '')"
      :disabled="readOnly"
      :options="spec.choices ?? []"
      @update:model-value="emit('set', spec.key, $event)"
    />

    <textarea
      v-else-if="spec.kind === 'options'"
      :id="id"
      v-model="optionsModel"
      rows="4"
      :disabled="readOnly"
      class="mb-input mb-input-mono"
    />

    <MimeTypePicker
      v-else-if="spec.kind === 'mimeTypes'"
      :id="id"
      :model-value="acceptList"
      @update:model-value="emit('update:acceptList', $event)"
    />

    <div v-else-if="spec.kind === 'toolbar'" class="flex flex-wrap gap-2">
      <button
        v-for="tool in TOOLS"
        :key="tool.value"
        type="button"
        :disabled="readOnly"
        class="rounded-pill border px-3 py-1 text-xs transition"
        :class="toolbarOf(field).includes(tool.value)
          ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-600/20 dark:text-brand-50'
          : 'border-surface-300 hover:border-surface-400 dark:border-surface-700 dark:hover:border-surface-500'"
        :aria-pressed="toolbarOf(field).includes(tool.value)"
        @click="toggleTool(field, tool.value)"
      >
        {{ tool.label }}
      </button>
    </div>

    <div v-else-if="spec.kind === 'types'" class="flex flex-wrap gap-2">
      <button
        v-for="candidate in candidateTypes"
        :key="candidate.id"
        type="button"
        :disabled="readOnly"
        class="rounded-pill border px-3 py-1 text-xs transition"
        :class="(field.type === 'block'
          ? field.settings.type === candidate.id
          : ((field.settings.types as string[]) ?? []).includes(candidate.id))
          ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-600/20 dark:text-brand-50'
          : 'border-surface-300 hover:border-surface-400 dark:border-surface-700 dark:hover:border-surface-500'"
        @click="emit('toggleType', candidate.id)"
      >
        {{ candidate.label }}
      </button>
      <p v-if="!candidateTypes.length" class="mb-hint">
        No {{ field.type === 'block' || field.type === 'blocks' ? 'block' : field.type === 'databag' ? 'databag' : 'content' }} types available yet.
      </p>
    </div>

    <div v-else-if="spec.kind === 'templates'" class="flex flex-wrap gap-2">
      <button
        v-for="candidate in candidateTemplates"
        :key="candidate.id"
        type="button"
        :disabled="readOnly"
        class="rounded-pill border px-3 py-1 text-xs transition"
        :class="((field.settings.templates as string[]) ?? []).includes(candidate.id)
          ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-600/20 dark:text-brand-50'
          : 'border-surface-300 hover:border-surface-400 dark:border-surface-700 dark:hover:border-surface-500'"
        @click="emit('toggleTemplate', candidate.id)"
      >
        {{ candidate.label }}
      </button>
      <p v-if="!candidateTemplates.length" class="mb-hint">No templates in this space yet.</p>
    </div>

    <div v-else-if="spec.kind === 'presets'" class="flex flex-wrap gap-2">
      <button
        v-for="preset in presets ?? []"
        :key="preset.name"
        type="button"
        :disabled="readOnly"
        class="rounded-pill border px-3 py-1 text-xs transition"
        :class="chosenPresets.includes(preset.name)
          ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-600/20 dark:text-brand-50'
          : 'border-surface-300 hover:border-surface-400 dark:border-surface-700 dark:hover:border-surface-500'"
        :aria-pressed="chosenPresets.includes(preset.name)"
        @click="togglePreset(preset.name)"
      >
        {{ preset.name }}
        <span class="text-surface-500">
          {{ preset.width ?? 'auto' }}x{{ preset.height ?? 'auto' }} {{ preset.format }}
        </span>
      </button>
      <p v-if="!presets?.length" class="mb-hint">This instance configures no presets.</p>
    </div>

    <ImageSizeList
      v-else-if="spec.kind === 'sizes'"
      :id="id"
      :model-value="field.settings[spec.key]"
      :read-only="readOnly"
      @update:model-value="emit('set', spec.key, $event)"
    />

    <div v-else-if="spec.kind === 'document'" class="flex flex-wrap items-center gap-2">
      <span
        v-if="chosenId.length"
        class="flex items-center gap-1.5 rounded-control border border-surface-200 px-2.5 py-1 text-sm dark:border-surface-700"
      >
        <span class="truncate">{{ chosenTitle ?? 'Unknown document' }}</span>
        <button type="button" :disabled="readOnly" aria-label="Clear" @click="emit('set', spec.key, undefined)">
          <Icon name="x" class="mb-icon-sm" />
        </button>
      </span>
      <ContentPicker
        v-if="!readOnly"
        :label="chosenId.length ? 'Pick another' : 'Pick a document'"
        :type-ids="Array.isArray(field.settings.types) ? (field.settings.types as string[]) : []"
        trigger-class="mb-btn-outline mb-btn-sm"
        trigger-icon="plus"
        @pick="emit('set', spec.key, $event.id)"
      />
    </div>

    <input
      v-else
      :id="id"
      v-model="textModel"
      :disabled="readOnly"
      class="mb-input"
    />

    <p v-if="spec.hint" class="mb-hint">{{ spec.hint }}</p>
  </FormField>
</template>
