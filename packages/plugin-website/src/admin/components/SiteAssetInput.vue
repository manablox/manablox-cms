<script setup lang="ts">
import {
  type FieldDefinition,
  FieldInput,
  provideFieldContext,
  useSpaceStore,
} from '@manablox/admin-sdk';
import { computed } from 'vue';

/** One asset of the site settings, through the content editor's asset input. */
const props = defineProps<{
  label: string;
  /** Mime prefixes the picker offers, e.g. `image/`. */
  accept?: string[];
  readOnly?: boolean;
}>();
const model = defineModel<string | null>({ required: true });

const spaces = useSpaceStore();

provideFieldContext(() => ({
  spaceId: spaces.currentId,
  locale: spaces.locale,
  errorFor: () => null,
  errorUnder: () => false,
  readOnly: props.readOnly === true,
  typeById: spaces.typeById,
  typeByName: spaces.typeByName,
  blockTypes: () => spaces.blockKinds,
  fieldTypeMeta: spaces.fieldTypeMeta,
}));

const settings = computed(() => ({ accept: props.accept ?? ['image/'] }));
const field = computed<FieldDefinition>(() => ({
  id: 'site-asset',
  name: 'siteAsset',
  label: props.label,
  type: 'asset',
  settings: settings.value,
  required: false,
  localized: false,
  unique: false,
  admin: { zone: 'main', width: 100, position: 0 },
}));

function update(value: unknown) {
  model.value = Array.isArray(value)
    ? ((value[0] as string | undefined) ?? null)
    : (value as string | null);
}
</script>

<template>
  <FieldInput
    :model-value="model"
    :field="field"
    :path="['site', label]"
    @update:model-value="update"
  />
</template>
