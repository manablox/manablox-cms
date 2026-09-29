<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import PageHeader from '@manablox/admin-sdk/components/PageHeader.vue';
import AsyncList from '@manablox/admin-sdk/components/ui/AsyncList.vue';
import EmptyState from '@manablox/admin-sdk/components/ui/EmptyState.vue';
import NewButton from '@manablox/admin-sdk/components/ui/NewButton.vue';
import SectionIntro from '@manablox/admin-sdk/components/ui/SectionIntro.vue';
import StatusBadge from '@manablox/admin-sdk/components/ui/StatusBadge.vue';
import { useTemplates } from '@manablox/admin-sdk/features/content/queries';
import { useCan } from '@manablox/admin-sdk/lib/space';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed } from 'vue';
import PluginSlot from '~/components/PluginSlot';

/** The `/templates` landing; the list is the shell's side column. */
const spaces = useSpaceStore();

const templateType = computed(() => spaces.templateType);
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
</script>

<template>
  <div class="mb-page-narrow">
    <PageHeader
      title="Templates"
      description="Blocks written once and used in many documents. A template field points at one of these, and every document holding that field renders whatever the template says today."
    >
      <PluginSlot id="template.list.actions" :props="{}" />
      <NewButton label="New template" to="/templates/new" :enabled="canWrite" />
    </PageHeader>

    <section class="mb-card space-y-3">
      <SectionIntro
        icon="template"
        title="Templates in this space"
        :count="page?.total ?? 0"
        blurb="Pick a template to edit its blocks. A template has to be published before a site sees it, exactly like a page: until then, the documents pointing at it deliver an empty block list. Templates stay out of the content tree, since they are pieces used by pages rather than pages of their own."
      />

      <EmptyState
        v-if="!templateType"
        compact
        icon="template"
        title="Templates are not available"
        description="The template type is missing from this installation."
      />
      <AsyncList
        v-else
        :pending="isPending"
        :error="error"
        :retry="refetch"
        :items="page?.items"
        empty-icon="template"
        empty-title="No templates yet"
        :empty-description="
          canWrite
            ? 'Start one, fill it with blocks, and point a template field at it.'
            : 'Someone with content rights can create one.'
        "
        item-class="flex items-center gap-3 py-2.5"
      >
        <template v-if="canWrite" #empty-actions>
          <RouterLink to="/templates/new" class="mb-btn-primary">Create template</RouterLink>
        </template>
        <template #item="{ item }">
          <Icon name="template" class="mb-icon shrink-0 text-surface-400" />
          <RouterLink :to="`/templates/${item.id}`" class="min-w-0 flex-1 truncate text-sm font-medium hover:underline">
            {{ item.title || 'Untitled' }}
          </RouterLink>
          <StatusBadge :status="item.status === 'published' ? 'live' : 'draft'" />
        </template>
      </AsyncList>
    </section>
  </div>
</template>
