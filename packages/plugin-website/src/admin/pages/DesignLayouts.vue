<script setup lang="ts">
import {
  EmptyState,
  Icon,
  IconButton,
  PageHeader,
  PageState,
  useMenus,
  useSpaceStore,
} from '@manablox/admin-sdk';
import {
  generateLayout,
  type LayoutDesign,
  type PageDesign,
  type SiteSettingsDesign,
} from '@manablox/site';
import { computed, ref } from 'vue';
import DesignCard from '../components/DesignCard.vue';
import DesignCreateDialog from '../components/DesignCreateDialog.vue';
import LayoutDeleteDialog from '../components/LayoutDeleteDialog.vue';
import SiteModePanel from '../components/SiteModePanel.vue';
import { layoutUsage } from '../model/layout-design';
import { designRoute, STATUS_META } from '../model/status';
import { useDesignsData, useSiteDesign, useSiteDesigns } from '../queries';
import { useSiteContext } from '../useSiteContext';

/** `/design/layouts`: the layouts of the site, which pages use each, create and delete. */
const spaces = useSpaceStore();
const site = useSiteContext();
const { settings, designed, canRead, canWrite, canPublish, canSwitch } = site;
const designs = useSiteDesigns();
const menus = useMenus();
const siteQuery = useSiteDesign('site', 'default');
const siteDesign = computed(
  () => (siteQuery.data.value?.data as SiteSettingsDesign | undefined) ?? null,
);

const layoutEntries = computed(() =>
  (designs.data.value ?? []).filter((entry) => entry.kind === 'layout'),
);
const storedLayouts = computed(() =>
  layoutEntries.value.filter((entry) => entry.id !== null).map((entry) => entry.key),
);
const layoutData = useDesignsData('layout', storedLayouts);
const storedPages = computed(() =>
  (designs.data.value ?? [])
    .filter((entry) => entry.kind === 'page' && entry.id !== null)
    .map((entry) => entry.key),
);
const pageData = useDesignsData('page', storedPages);

const typeIds = computed(() => spaces.creatableKinds.map((type) => type.id));
const typeLabel = (id: string) => spaces.typeById(id)?.label ?? id;

const rows = computed(() => {
  const existing = new Set(storedLayouts.value);
  const pages = (pageData.data.value ?? {}) as Record<string, PageDesign | null>;
  return layoutEntries.value.map((entry) => ({
    entry,
    uses: layoutUsage(entry.key, typeIds.value, pages, siteDesign.value, existing),
  }));
});

const generatedDefault = () => {
  const space = spaces.current;
  return generateLayout(
    { name: space?.name ?? '', defaultLocale: space?.defaultLocale ?? 'en' },
    menus.data.value ?? [],
  );
};

const sources = computed(() => [
  { value: '', label: 'Header, page and footer (generated)', data: generatedDefault },
  ...layoutEntries.value.map((entry) => ({
    value: entry.key,
    label: `A copy of ${entry.label}`,
    data: () =>
      (layoutData.data.value?.[entry.key] as LayoutDesign | undefined) ?? generatedDefault(),
  })),
]);
const taken = computed(() => layoutEntries.value.map((entry) => entry.key));

const creating = ref<{ from: string; name: string } | null>(null);
const deleting = ref<(typeof rows.value)[number] | null>(null);

function usesText(uses: ReturnType<typeof layoutUsage>): string {
  if (uses.length === 0) return 'No pages use it';
  const names = uses.slice(0, 3).map((use) => typeLabel(use.typeId));
  const more = uses.length > 3 ? ` and ${uses.length - 3} more` : '';
  return `Used by ${names.join(', ')}${more}`;
}
</script>

<template>
  <PageState :loading="settings.isPending.value" :error="settings.error.value" :retry="settings.refetch" loading-label="Loading the layouts...">
    <div class="mb-page">
      <PageHeader title="Layouts" description="The frame around your pages: the header with logo and menu, and the footer. Every page uses the default layout unless you pick another in its page design or the site settings.">
        <button v-if="designed && canWrite" type="button" class="mb-btn-primary" @click="creating = { from: '', name: '' }">
          <Icon name="plus" /> New layout
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

      <ul v-else class="ws:grid ws:gap-3 ws:md:grid-cols-2 ws:2xl:grid-cols-3">
        <DesignCard
          v-for="row in rows"
          :key="row.entry.key"
          :to="designRoute('layout', row.entry.key) ?? '/design/layouts'"
          icon="panels-top-left"
          :title="row.entry.label"
          :meta="usesText(row.uses)"
          :status="row.entry.status"
          :open-label="`Open the designer of ${row.entry.label}`"
        >
          <template #actions>
            <IconButton
              v-if="canWrite"
              icon="copy"
              :label="`Duplicate ${row.entry.label}`"
              title="Duplicate"
              @click="creating = { from: row.entry.key, name: `${row.entry.label} copy` }"
            />
            <IconButton
              v-if="canPublish && row.entry.key !== 'default' && row.entry.id"
              icon="trash"
              :label="`Delete ${row.entry.label}`"
              title="Delete"
              danger
              @click="deleting = row"
            />
          </template>
        </DesignCard>
      </ul>
    </div>

    <DesignCreateDialog
      v-if="creating"
      kind="layout"
      :taken="taken"
      :sources="sources"
      :from="creating.from"
      :initial-name="creating.name"
      @close="creating = null"
    />
    <LayoutDeleteDialog
      v-if="deleting && deleting.entry.id"
      :id="deleting.entry.id"
      :layout-key="deleting.entry.key"
      :label="deleting.entry.label"
      :uses="deleting.uses.map((use) => ({ ...use, label: typeLabel(use.typeId) }))"
      :layouts="layoutEntries.filter((entry) => entry.key !== deleting?.entry.key).map((entry) => ({ value: entry.key, label: entry.label }))"
      @close="deleting = null"
    />
  </PageState>
</template>
