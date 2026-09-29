<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import Select from '@manablox/admin-sdk/components/ui/Select.vue';
import { useFieldContext } from '@manablox/admin-sdk/lib/field-context';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed } from 'vue';
import type { FieldInputProps } from '~/lib/field-input';

/** Stores a databag type id; a site form bound to the field stores entries there. */
const props = defineProps<FieldInputProps>();
const emit = defineEmits<{ 'update:modelValue': [string | null] }>();

const context = useFieldContext();
const spaces = useSpaceStore();

/** An empty `types` setting offers every databag type. */
const allowed = computed(() => {
  const ids = Array.isArray(props.settings.types) ? (props.settings.types as string[]) : [];
  return ids.length ? spaces.dataKinds.filter((type) => ids.includes(type.id)) : spaces.dataKinds;
});

const options = computed(() => [
  { value: '', label: 'No databag type' },
  ...allowed.value.map((type) => ({ value: type.id, label: type.label })),
]);

const selectedId = computed(() => (typeof props.modelValue === 'string' ? props.modelValue : ''));
const selected = computed(() => allowed.value.find((type) => type.id === selectedId.value) ?? null);

/** The value points at a databag type that is deleted or not offered here. */
const dangling = computed(() => Boolean(selectedId.value) && !selected.value);

function onChange(value: string) {
  emit('update:modelValue', value || null);
}
</script>

<template>
  <div class="space-y-1.5">
    <p v-if="!allowed.length" class="mb-hint">
      No databag types yet. Create one under Databag types, then pick it here.
    </p>
    <Select v-else :id="id" :model-value="selectedId" :options="options" :disabled="context.readOnly" @update:model-value="onChange" />

    <p v-if="dangling" class="mb-error">
      The databag type this field points at is gone or no longer offered here.
    </p>
    <RouterLink
      v-else-if="selected"
      :to="`/databag-types/${selected.id}`"
      class="mb-hint inline-flex items-center gap-1 hover:underline"
    >
      <Icon name="external" class="mb-icon-sm" />
      Edit the fields of "{{ selected.label }}"
    </RouterLink>
  </div>
</template>
