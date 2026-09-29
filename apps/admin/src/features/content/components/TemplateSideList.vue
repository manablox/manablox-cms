<script setup lang="ts">
import EntityPanel from '@manablox/admin-sdk/components/layout/EntityPanel.vue';
import { useTemplates } from '@manablox/admin-sdk/features/content/queries';
import { useCan } from '@manablox/admin-sdk/lib/space';
import { typeIcon } from '@manablox/admin-sdk/lib/type-icon';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed } from 'vue';

/** Template side column, mounted by `Shell` on `/templates` routes. */
const spaces = useSpaceStore();

const templateType = computed(() => spaces.templateType);
// Templates hold a block list per locale.
const {
  data: page,
  isPending,
  error,
  refetch,
} = useTemplates(
  () => spaces.locale,
  () => templateType.value?.id ?? null,
);

const canWriteType = useCan('content:write', () => templateType.value?.id);
const canWrite = computed(() => Boolean(templateType.value) && canWriteType.value);

/** Distinguishes a missing template type from an empty list. */
const empty = computed(() =>
  templateType.value
    ? { title: 'No templates yet', description: 'Use + to write one.' }
    : {
        title: 'Not available',
        description: 'The template type is missing from this installation.',
      },
);
</script>

<template>
  <EntityPanel
    label="Templates"
    to="/templates"
    panel-key="templates"
    :icon="typeIcon(templateType, 'template')"
    :items="templateType ? page?.items : []"
    :pending="Boolean(templateType) && isPending"
    :error="error"
    :retry="refetch"
    :empty-title="empty.title"
    :empty-description="empty.description"
    :item-to="(template) => `/templates/${template.id}`"
    create-label="New template"
    create-to="/templates/new"
    :can-create="canWrite"
  >
    <template #item="{ item }">
      <span class="block truncate text-sm font-medium">{{ item.title || 'Untitled' }}</span>
    </template>

    <template #trailing="{ item }">
      <span
        v-if="item.status === 'published'"
        class="h-1.5 w-1.5 shrink-0 rounded-pill bg-ok-500 shadow-[0_0_6px] shadow-ok-500/80"
        title="Published"
      />
    </template>
  </EntityPanel>
</template>
