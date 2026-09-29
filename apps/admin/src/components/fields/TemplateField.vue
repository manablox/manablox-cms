<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import Loader from '@manablox/admin-sdk/components/ui/Loader.vue';
import Select from '@manablox/admin-sdk/components/ui/Select.vue';
import { useTemplates } from '@manablox/admin-sdk/features/content/queries';
import { useFieldContext } from '@manablox/admin-sdk/lib/field-context';
import { computed } from 'vue';
import type { FieldInputProps } from '~/lib/field-input';

/** Stores a template id; blocks are edited on the template itself. */
const props = defineProps<FieldInputProps>();
const emit = defineEmits<{ 'update:modelValue': [string | null] }>();

const context = useFieldContext();
const templateType = computed(() => context.value.typeByName('template'));

const { data: page, isPending } = useTemplates(
  () => context.value.locale,
  () => templateType.value?.id ?? null,
  () => context.value.spaceId,
);

/** An empty `templates` setting offers every template. */
const allowed = computed(() => {
  const ids = Array.isArray(props.settings.templates) ? (props.settings.templates as string[]) : [];
  const items = page.value?.items ?? [];
  return ids.length ? items.filter((item) => ids.includes(item.id)) : items;
});

const options = computed(() => [
  { value: '', label: 'No template' },
  ...allowed.value.map((item) => ({ value: item.id, label: item.title || 'Untitled' })),
]);

const selectedId = computed(() => (typeof props.modelValue === 'string' ? props.modelValue : ''));
const selected = computed(() => allowed.value.find((item) => item.id === selectedId.value) ?? null);

/** The value points at a template that is deleted or not offered here. */
const dangling = computed(() => Boolean(selectedId.value) && !selected.value);

function onChange(value: string) {
  emit('update:modelValue', value || null);
}
</script>

<template>
  <div class="space-y-1.5">
    <Loader v-if="isPending" inline class="text-sm" />
    <p v-else-if="!templateType" class="mb-hint">Templates are not available in this installation.</p>
    <p v-else-if="!allowed.length" class="mb-hint">
      No templates yet. Create one under Templates, then pick it here.
    </p>
    <Select v-else :id="id" :model-value="selectedId" :options="options" :disabled="context.readOnly" @update:model-value="onChange" />

    <p v-if="dangling" class="mb-error">
      The template this field points at is gone or no longer offered here.
    </p>
    <RouterLink
      v-else-if="selected"
      :to="`/templates/${selected.id}`"
      class="mb-hint inline-flex items-center gap-1 hover:underline"
    >
      <Icon name="external" class="mb-icon-sm" />
      Edit "{{ selected.title || 'Untitled' }}"
      <span v-if="selected.status !== 'published'">- not published yet</span>
    </RouterLink>
  </div>
</template>
