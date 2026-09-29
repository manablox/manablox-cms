<script setup lang="ts">
import EntityPanel from '@manablox/admin-sdk/components/layout/EntityPanel.vue';
import { useMenus } from '@manablox/admin-sdk/features/menus/queries';
import { useCan } from '@manablox/admin-sdk/lib/space';
import { ref } from 'vue';
import MenuCreateDialog from '~/features/menus/components/MenuCreateDialog.vue';

/** Menu side column, mounted by `Shell` on `/menus` routes. */
const menus = useMenus();
const canWrite = useCan('menu:write');
const creating = ref(false);
</script>

<template>
  <EntityPanel
    label="Menus"
    to="/menus"
    panel-key="menus"
    icon="menu"
    :query="menus"
    empty-title="No menus yet"
    empty-description="Use + to create one."
    :item-to="(menu) => `/menus/${menu.id}`"
    create-label="New menu"
    :can-create="canWrite"
    @create="creating = true"
  >
    <template #action>
      <MenuCreateDialog v-if="creating" @close="creating = false" />
    </template>

    <template #item="{ item }">
      <span class="block truncate text-sm font-medium">{{ item.name }}</span>
      <span class="block truncate font-mono text-2xs text-surface-500">{{ item.machineName }}</span>
    </template>
  </EntityPanel>
</template>
