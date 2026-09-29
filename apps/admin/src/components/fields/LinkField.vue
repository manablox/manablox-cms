<script setup lang="ts">
import ContentPicker from '@manablox/admin-sdk/components/ContentPicker.vue';
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import SegmentedControl from '@manablox/admin-sdk/components/ui/SegmentedControl.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { useContentByIds } from '@manablox/admin-sdk/features/content/queries';
import { useFieldContext } from '@manablox/admin-sdk/lib/field-context';
import type { LinkMode, LinkTarget, LinkValue } from '@manablox/core';
import { computed } from 'vue';
import type { FieldInputProps } from '~/lib/field-input';

/** Internal or external link; both targets are kept so switching mode loses nothing. */
const props = defineProps<FieldInputProps>();
const emit = defineEmits<{ 'update:modelValue': [LinkValue | null] }>();

const context = useFieldContext();

const allowInternal = computed(() => props.settings.allowInternal !== false);
const allowExternal = computed(() => props.settings.allowExternal !== false);
const allowLabel = computed(() => props.settings.allowLabel !== false);
const allowTarget = computed(() => props.settings.allowTarget !== false);
const defaultTarget = computed<LinkTarget>(() =>
  props.settings.defaultTarget === '_blank' ? '_blank' : '_self',
);
const typeIds = computed(() =>
  Array.isArray(props.settings.types) ? (props.settings.types as string[]) : [],
);

/** Lenient read of the stored value. */
const value = computed<LinkValue | null>(() => {
  const raw = props.modelValue as Partial<LinkValue> | null | undefined;
  if (!raw || typeof raw !== 'object') return null;
  if (raw.mode !== 'internal' && raw.mode !== 'external') return null;
  return {
    mode: raw.mode,
    contentId: typeof raw.contentId === 'string' ? raw.contentId : null,
    url: typeof raw.url === 'string' ? raw.url : null,
    target: raw.target === '_blank' ? '_blank' : '_self',
    label: typeof raw.label === 'string' ? raw.label : null,
  };
});

const mode = computed<LinkMode>(
  () => value.value?.mode ?? (allowInternal.value ? 'internal' : 'external'),
);

const MODES = computed(() =>
  [
    ...(allowInternal.value ? [{ value: 'internal', label: 'A document' }] : []),
    ...(allowExternal.value ? [{ value: 'external', label: 'An address' }] : []),
  ].map((entry) => entry),
);

const TARGETS = [
  { value: '_self', label: 'Same tab' },
  { value: '_blank', label: 'New tab' },
];

const selectedIds = computed(() =>
  value.value?.mode === 'internal' && value.value.contentId ? [value.value.contentId] : [],
);
const { data: documents } = useContentByIds(selectedIds, () => context.value.spaceId);
const document = computed(() => documents.value?.[0] ?? null);

function write(patch: Partial<LinkValue>) {
  const base: LinkValue = value.value ?? {
    mode: mode.value,
    contentId: null,
    url: null,
    target: defaultTarget.value,
    label: null,
  };
  emit('update:modelValue', { ...base, ...patch });
}

function clear() {
  emit('update:modelValue', null);
}
</script>

<template>
  <div class="space-y-2">
    <SegmentedControl
      v-if="MODES.length > 1"
      :model-value="mode"
      :options="MODES"
      :columns="MODES.length"
      :aria-label="`${field.label}: what it points at`"
      @update:model-value="write({ mode: $event as LinkMode })"
    />

    <div v-if="mode === 'internal'" class="space-y-2">
      <div
        v-if="document"
        class="flex items-center gap-2 rounded-control border border-surface-200 px-2.5 py-1.5 text-sm dark:border-surface-700"
      >
        <Icon name="link" class="mb-icon-sm shrink-0 text-surface-400" />
        <span class="min-w-0 flex-1 truncate">{{ document.title }}</span>
        <span class="truncate font-mono text-2xs text-surface-500">
          {{ document.permalink != null ? `/${document.permalink}` : '' }}
        </span>
        <button v-if="!context.readOnly" type="button" aria-label="Remove the document" @click="write({ contentId: null })">
          <Icon name="x" class="mb-icon-sm" />
        </button>
      </div>
      <ContentPicker
        v-if="!context.readOnly"
        :type-ids="typeIds"
        :label="document ? 'Pick another document' : 'Pick a document'"
        trigger-icon="plus"
        @pick="write({ mode: 'internal', contentId: $event.id })"
      />
    </div>

    <TextField
      v-else
      :id="id"
      type="url"
      :placeholder="(field.admin.placeholder as string) ?? 'https://example.com/page'"
      :model-value="value?.url ?? ''"
      @update:model-value="write({ mode: 'external', url: String($event ?? '') || null })"
    />

    <div class="grid gap-2 sm:grid-cols-2">
      <div v-if="allowTarget">
        <SegmentedControl
          :model-value="value?.target ?? defaultTarget"
          :options="TARGETS"
          :columns="2"
          :aria-label="`${field.label}: where it opens`"
          @update:model-value="write({ target: $event as LinkTarget })"
        />
      </div>
      <TextField
        v-if="allowLabel"
        type="text"
        placeholder="Link text (optional)"
        :model-value="value?.label ?? ''"
        :aria-label="`${field.label}: link text`"
        @update:model-value="write({ label: String($event ?? '') || null })"
      />
    </div>

    <button v-if="value && !context.readOnly" type="button" class="mb-btn-ghost mb-btn-sm" @click="clear">
      <Icon name="x" class="mb-icon-sm" /> Clear the link
    </button>
  </div>
</template>
