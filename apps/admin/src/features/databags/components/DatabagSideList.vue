<script setup lang="ts">
import EntityPanel from '@manablox/admin-sdk/components/layout/EntityPanel.vue';
import StatusBadge from '@manablox/admin-sdk/components/ui/StatusBadge.vue';
import { useContentTypes } from '@manablox/admin-sdk/features/content-types/queries';
import { useCan } from '@manablox/admin-sdk/lib/space';
import { typeIcon } from '@manablox/admin-sdk/lib/type-icon';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed } from 'vue';
import { useRoute } from 'vue-router';

/** The databag types as a side list: their entries (`entries`) or their definitions (`types`). */
const props = defineProps<{ mode: 'entries' | 'types' }>();

const spaces = useSpaceStore();
const route = useRoute();
const types = useContentTypes();
const canDefine = useCan('contentType:write');

const isTypes = computed(() => props.mode === 'types');
const base = computed(() => (isTypes.value ? '/databag-types' : '/databags'));
const emptyDescription = computed(() => {
  if (isTypes.value) return 'Use + to define one.';
  return canDefine.value ? 'Define a databag type first.' : 'An administrator defines them.';
});
</script>

<template>
  <EntityPanel
    :label="isTypes ? 'Databag types' : 'Databags'"
    :to="base"
    :panel-key="isTypes ? 'databagTypes' : 'databags'"
    icon="database"
    :items="spaces.dataKinds"
    :pending="types.isPending.value"
    :error="types.error.value"
    :retry="types.refetch"
    :empty-title="isTypes ? 'No databag types yet' : 'No databags yet'"
    :empty-description="emptyDescription"
    :item-to="(type) => `${base}/${type.id}`"
    :item-icon="(type) => typeIcon(type)"
    :active="(type) => (isTypes ? route.params.id : route.params.typeId) === type.id"
    create-label="New databag type"
    create-to="/databag-types/new"
    :can-create="canDefine"
  >
    <template #item="{ item }">
      <span class="block truncate text-sm font-medium">{{ item.label }}</span>
      <span class="block truncate font-mono text-2xs text-surface-500">{{ item.name }}</span>
    </template>

    <template v-if="isTypes" #trailing="{ item }">
      <StatusBadge v-if="item.source === 'code'" status="code" class="shrink-0" title="Declared in code; read-only here" />
      <span v-else class="shrink-0 font-mono text-2xs text-surface-400 tabular-nums" :title="`${item.fields.length} fields`">{{ item.fields.length }}</span>
    </template>
  </EntityPanel>
</template>
