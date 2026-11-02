<script setup lang="ts">
import { FormDialog, FormField, requireSpace, runWrite, Select } from '@manablox/admin-sdk';
import { computed, ref } from 'vue';
import type { LayoutUse } from '../model/layout-design';
import { design } from '../queries';

/** Deletes a layout; pages that use it move to another layout first. */
const props = defineProps<{
  id: string;
  layoutKey: string;
  label: string;
  uses: ReadonlyArray<LayoutUse & { label: string }>;
  /** The other layouts. */
  layouts: ReadonlyArray<{ value: string; label: string }>;
}>();
const emit = defineEmits<{ close: [] }>();

const to = ref(
  props.layouts.some((entry) => entry.value === 'default')
    ? 'default'
    : (props.layouts[0]?.value ?? 'default'),
);
const busy = ref(false);
const used = computed(() => props.uses.length > 0);

async function submit() {
  const spaceId = requireSpace();
  return runWrite(
    () => design.deleteLayout(spaceId, { id: props.id, key: props.layoutKey, to: to.value }),
    {
      busy,
      success: `Deleted the layout "${props.label}"`,
    },
  );
}
</script>

<template>
  <FormDialog
    :title="`Delete the layout &quot;${label}&quot;?`"
    submit-label="Delete layout"
    busy-label="Deleting..."
    danger
    :busy="busy"
    :on-submit="submit"
    @close="emit('close')"
  >
    <template v-if="used">
      <p class="ws:text-sm">These page designs use it, so they move to another layout (as drafts until you publish them):</p>
      <ul class="ws:list-disc ws:pl-5 ws:text-sm">
        <li v-for="use in uses" :key="use.typeId">
          {{ use.label }} <span class="ws:text-surface-500">({{ use.via === 'page' ? 'picked in its page design' : 'assigned in Site settings' }})</span>
        </li>
      </ul>
      <FormField label="Move them to">
        <template #default="{ id }">
          <Select :id="id" v-model="to" :options="layouts" />
        </template>
      </FormField>
    </template>
    <p v-else class="ws:text-sm">No page uses it. Its draft, live copy and versions are removed.</p>
    <p class="mb-hint">Wherever the live site used it, it shows the default layout until the moved designs are published.</p>
  </FormDialog>
</template>
