<script setup lang="ts">
import {
  AsyncList,
  EmptyState,
  Icon,
  IconButton,
  PageHeader,
  PageState,
  useMenus,
  useSpaceStore,
} from '@manablox/admin-sdk';
import type { MenuDesign } from '@manablox/site';
import { computed, ref } from 'vue';
import DesignCard from '../components/DesignCard.vue';
import DesignCreateDialog from '../components/DesignCreateDialog.vue';
import SiteModePanel from '../components/SiteModePanel.vue';
import { MENU_PRESETS, menuDesignRows, presetDesign } from '../model/menu-design';
import { designRoute, STATUS_META } from '../model/status';
import { useDesignsData, useSiteDesigns } from '../queries';
import { useDesignActions } from '../useDesignActions';
import { useSiteContext } from '../useSiteContext';

/** `/design/menus`: a design per menu of the space, plus shared menu designs. */
const spaces = useSpaceStore();
const site = useSiteContext();
const { settings, designed, canRead, canWrite, canPublish, canSwitch } = site;
const designs = useSiteDesigns();
const menus = useMenus();
const actions = useDesignActions();

const rows = computed(() => menuDesignRows(menus.data.value ?? [], designs.data.value ?? []));
const storedKeys = computed(() => rows.value.filter((row) => row.stored).map((row) => row.key));
const stored = useDesignsData('menu', storedKeys);
const presetLabel = (key: string) => {
  const data = stored.data.value?.[key] as MenuDesign | undefined;
  return data
    ? (MENU_PRESETS.find((entry) => entry.value === data.preset)?.label ?? data.preset)
    : null;
};

const sources = computed(() => [
  ...MENU_PRESETS.map((preset) => ({
    value: `preset:${preset.value}`,
    label: preset.label,
    data: () => presetDesign(preset.value),
  })),
  ...rows.value
    .filter((row) => row.stored)
    .map((row) => ({
      value: row.key,
      label: `A copy of ${row.label}`,
      data: () => stored.data.value?.[row.key] ?? presetDesign('dropdown'),
    })),
]);
const taken = computed(() => rows.value.map((row) => row.key));
const creating = ref<{ from: string; name: string } | null>(null);

function summaryOf(key: string) {
  const entry = (designs.data.value ?? []).find((item) => item.kind === 'menu' && item.key === key);
  return entry?.id ? { ...entry, id: entry.id } : null;
}
</script>

<template>
  <PageState :loading="settings.isPending.value" :error="settings.error.value" :retry="settings.refetch" loading-label="Loading the menu designs...">
    <div class="mb-page">
      <PageHeader title="Menu designs" description="How your menus look: a bar, a dropdown or footer columns, and what happens on phones. Each menu has its own design; a shared design can be used by any menu in a layout. The entries themselves are edited under Menus.">
        <button v-if="designed && canWrite" type="button" class="mb-btn-primary" @click="creating = { from: 'preset:dropdown', name: '' }">
          <Icon name="plus" /> New shared design
        </button>
      </PageHeader>

      <EmptyState v-if="!canRead" icon="lock" title="No access to the design" description="Someone who manages this space's roles can give you design rights." />

      <SiteModePanel
        v-else-if="!designed && spaces.currentId && settings.data.value"
        :space-id="spaces.currentId"
        :mode="settings.data.value.mode"
        :can-switch="canSwitch"
        :frontend-url="spaces.current?.url"
      />

      <AsyncList
        v-else
        :pending="designs.isPending.value || menus.isPending.value"
        :error="designs.error.value ?? menus.error.value"
        :retry="() => { void designs.refetch(); void menus.refetch(); }"
        :items="rows"
        empty-icon="menu"
        empty-title="No menus yet"
        empty-description="Create a menu under Menus; its design shows up here."
      >
        <template #default>
          <ul class="ws:grid ws:gap-3 ws:md:grid-cols-2 ws:2xl:grid-cols-3">
            <DesignCard
              v-for="row in rows"
              :key="row.key"
              :to="designRoute('menu', row.key) ?? '/design/menus'"
              icon="menu"
              :title="row.label"
              :meta="`${row.menuId ? 'The design of this menu' : 'Shared design'}${presetLabel(row.key) ? `, ${presetLabel(row.key)}` : ''}`"
              :status="row.status"
              :open-label="`Open the designer of ${row.label}`"
            >
              <template #actions>
                <RouterLink v-if="row.menuId" :to="`/menus/${row.menuId}`" class="mb-btn-ghost mb-btn-icon mb-btn-sm" :aria-label="`Edit the entries of ${row.label}`" title="Edit the entries">
                  <Icon name="file-pen" class="mb-icon-sm" />
                </RouterLink>
                <IconButton
                  v-if="canWrite && row.stored"
                  icon="copy"
                  :label="`Duplicate ${row.label}`"
                  title="Duplicate as a shared design"
                  @click="creating = { from: row.key, name: `${row.label} copy` }"
                />
                <IconButton
                  v-if="canPublish && summaryOf(row.key)"
                  :icon="row.menuId ? 'reset' : 'trash'"
                  :label="row.menuId ? `Reset ${row.label} to the automatic design` : `Delete ${row.label}`"
                  :title="row.menuId ? 'Start over with the automatic design' : 'Delete'"
                  danger
                  @click="actions.reset(summaryOf(row.key)!)"
                />
              </template>
            </DesignCard>
          </ul>
        </template>
      </AsyncList>
    </div>

    <DesignCreateDialog
      v-if="creating"
      kind="menu"
      :taken="taken"
      :sources="sources"
      :from="creating.from"
      :initial-name="creating.name"
      @close="creating = null"
    />
  </PageState>
</template>
