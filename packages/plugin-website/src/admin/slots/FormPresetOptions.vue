<script setup lang="ts">
import type { AdminSlotProps } from '@manablox/admin-plugin';
import { FormField, Select, useSpaceStore } from '@manablox/admin-sdk';
import { computed } from 'vue';

/** The databag type a fixed-form block's form stores in, below the preset picker. */
const props = defineProps<AdminSlotProps['contentType.presets']>();

const spaces = useSpaceStore();
const options = computed(() =>
  spaces.dataKinds.map((type) => ({ value: type.id, label: type.label })),
);
const databag = computed({
  get: () => (typeof props.draft.databag === 'string' ? props.draft.databag : ''),
  set: (value: string) => props.setDraft({ databag: value }),
});
</script>

<template>
  <FormField
    label="The form stores entries in"
    hint="Its design gets a form with an input per field of this databag type."
    class="ws:mt-4 ws:max-w-md"
  >
    <template #default="{ id }">
      <Select
        v-if="options.length"
        :id="id"
        v-model="databag"
        :options="options"
        placeholder="Pick a databag type"
      />
      <p v-else class="mb-hint">
        No databag types yet. <RouterLink to="/databag-types/new" class="ws:underline">Create one</RouterLink>, e.g. "Contact submission", then come back.
      </p>
    </template>
  </FormField>
</template>
