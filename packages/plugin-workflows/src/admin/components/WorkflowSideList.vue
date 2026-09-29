<script setup lang="ts">
import { EntityPanel, plural, useCan, useSpaceStore } from '@manablox/admin-sdk';
import { computed, ref } from 'vue';
import { triggerKind } from '../model';
import { useWorkflows, type WorkflowListItem } from '../queries';
import WorkflowCreateDialog from './WorkflowCreateDialog.vue';

/** Workflow side column, mounted by `Shell` on `/workflows` routes. */
const spaces = useSpaceStore();
const { data, isPending, error, refetch } = useWorkflows();
const canWrite = useCan('workflows:write');
const creating = ref(false);

/** The row after the loaded ones that leads to the full list. */
interface MoreRow {
  id: 'more';
  more: number;
}
type Row = WorkflowListItem | MoreRow;
const isMore = (row: Row): row is MoreRow => 'more' in row;

const rows = computed<Row[] | undefined>(() => {
  const page = data.value;
  if (!page) return undefined;
  const more = page.total - page.items.length;
  return more > 0 ? [...page.items, { id: 'more', more }] : page.items;
});
</script>

<template>
  <EntityPanel
    label="Workflows"
    to="/workflows"
    panel-key="workflows"
    icon="workflow"
    :items="rows"
    :pending="isPending"
    :error="error"
    :retry="refetch"
    empty-title="No workflows yet"
    empty-description="Use + to create one."
    :item-to="(row) => (isMore(row) ? '/workflows' : `/workflows/${row.id}`)"
    :item-icon="(row) => (isMore(row) ? 'list' : triggerKind(row.trigger.kind).icon)"
    :active="(row) => !isMore(row) && $route.params.id === row.id"
    create-label="New workflow"
    :can-create="canWrite"
    @create="creating = true"
  >
    <template #action>
      <WorkflowCreateDialog v-if="creating && spaces.currentId" :space-id="spaces.currentId" @close="creating = false" />
    </template>

    <template #item="{ item }">
      <span v-if="isMore(item)" class="wf:block wf:truncate wf:text-sm wf:text-surface-500">{{ plural(item.more, 'more workflow') }} in the full list</span>
      <template v-else>
        <span class="wf:block wf:truncate wf:text-sm wf:font-medium">{{ item.name }}</span>
        <span class="wf:block wf:truncate wf:text-2xs wf:text-surface-500">
          {{ item.publishedVersion === null ? 'Draft' : `v${item.publishedVersion}${item.draftChanged ? ', changed' : ''}` }},
          {{ plural(item.nodes.length, 'node') }}
        </span>
      </template>
    </template>

    <template #trailing="{ item }">
      <span
        v-if="!isMore(item)"
        class="wf:h-2 wf:w-2 wf:shrink-0 wf:rounded-pill"
        :class="item.enabled ? 'wf:bg-ok-500' : 'wf:bg-surface-300 wf:dark:bg-surface-700'"
        :title="item.enabled ? 'On' : 'Off'"
      />
    </template>
  </EntityPanel>
</template>
