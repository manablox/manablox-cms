<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import PageHeader from '@manablox/admin-sdk/components/PageHeader.vue';
import AsyncList from '@manablox/admin-sdk/components/ui/AsyncList.vue';
import NewButton from '@manablox/admin-sdk/components/ui/NewButton.vue';
import SectionIntro from '@manablox/admin-sdk/components/ui/SectionIntro.vue';
import { useMenus } from '@manablox/admin-sdk/features/menus/queries';
import { useCan } from '@manablox/admin-sdk/lib/space';
import { ref } from 'vue';
import MenuCreateDialog from '~/features/menus/components/MenuCreateDialog.vue';

/** The `/menus` landing. */

const { data: menus, isPending, error, refetch } = useMenus();
const canWrite = useCan('menu:write');
const creating = ref(false);
</script>

<template>
  <div class="mb-page-narrow">
    <PageHeader
      title="Menus"
      description="The navigations a site renders - main, footer, legal. A document can sit in any number of them, and a menu can link outside the site too."
    >
      <NewButton label="New menu" :enabled="canWrite" @click="creating = true" />
    </PageHeader>

    <section class="mb-card space-y-3">
      <SectionIntro
        icon="menu"
        title="Menus in this space"
        :count="menus?.length ?? 0"
        blurb="Pick a menu to edit its entries: add documents from the tree, nest them, reorder them, or add a plain link. The site fetches a menu by its technical name."
      />
      <AsyncList
        :pending="isPending"
        :error="error"
        :retry="refetch"
        :items="menus"
        empty-icon="menu"
        empty-title="No menus yet"
        :empty-description="canWrite ? 'Start with one called main.' : 'Someone with menu rights can create one.'"
        item-class="flex items-center gap-3 py-2.5"
      >
        <template v-if="canWrite" #empty-actions>
          <button type="button" class="mb-btn-primary" @click="creating = true">Create menu</button>
        </template>
        <template #item="{ item }">
          <Icon name="menu" class="mb-icon shrink-0 text-surface-400" />
          <RouterLink :to="`/menus/${item.id}`" class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium hover:underline">{{ item.name }}</span>
            <span class="block truncate font-mono mb-meta">{{ item.machineName }}</span>
          </RouterLink>
        </template>
      </AsyncList>
    </section>

    <MenuCreateDialog v-if="creating" @close="creating = false" />
  </div>
</template>
