<script setup lang="ts">
import {
  EmptyState,
  Icon,
  PageHeader,
  PageState,
  plural,
  typeIcon,
  useSpaceStore,
} from '@manablox/admin-sdk';
import {
  findBrokenBindings,
  findUnplacedFields,
  generatePageDesign,
  type PageDesign,
  type SiteSettingsDesign,
} from '@manablox/site';
import { computed } from 'vue';
import DesignCard from '../components/DesignCard.vue';
import SiteModePanel from '../components/SiteModePanel.vue';
import { layoutKeyFor } from '../model/site-preview';
import { designRoute, STATUS_META } from '../model/status';
import { useDesignsData, useSiteDesign, useSiteDesigns } from '../queries';
import { useSiteContext } from '../useSiteContext';

/** `/design/pages`: every content type with its page design's status, layout and warnings. */
const spaces = useSpaceStore();
const site = useSiteContext();
const { settings, designed, canRead, canSwitch } = site;
const designs = useSiteDesigns();
const siteQuery = useSiteDesign('site', 'default');
const siteDesign = computed(
  () => (siteQuery.data.value?.data as SiteSettingsDesign | undefined) ?? null,
);

const summaries = computed(
  () =>
    new Map(
      (designs.data.value ?? [])
        .filter((entry) => entry.kind === 'page')
        .map((entry) => [entry.key, entry]),
    ),
);
const layouts = computed(
  () =>
    new Map(
      (designs.data.value ?? [])
        .filter((entry) => entry.kind === 'layout')
        .map((entry) => [entry.key, entry.label]),
    ),
);
const storedKeys = computed(() =>
  [...summaries.value.values()].filter((entry) => entry.id !== null).map((entry) => entry.key),
);
const stored = useDesignsData('page', storedKeys);

const rows = computed(() =>
  spaces.creatableKinds.map((type) => {
    const data = stored.data.value?.[type.id] as PageDesign | null | undefined;
    const design = data ?? generatePageDesign(type);
    const layoutKey = layoutKeyFor(design, siteDesign.value, type.id);
    return {
      type,
      status: summaries.value.get(type.id)?.status ?? 'generated',
      layout: layouts.value.get(layoutKey) ?? `${layoutKey} (missing)`,
      unplaced: findUnplacedFields(design, type).length,
      broken: findBrokenBindings(design, type).length,
    };
  }),
);
</script>

<template>
  <PageState :loading="settings.isPending.value" :error="settings.error.value" :retry="settings.refetch" loading-label="Loading the page designs...">
    <div class="mb-page">
      <PageHeader title="Page designs" description="How the pages of each content type look: where the title, the text and the blocks go, and which layout frames them. Until you design one, a page shows its title and every field." />

      <EmptyState v-if="!canRead" icon="lock" title="No access to the design" description="Someone who manages this space's roles can give you design rights." />

      <SiteModePanel
        v-else-if="!designed && spaces.currentId && settings.data.value"
        :space-id="spaces.currentId"
        :mode="settings.data.value.mode"
        :can-switch="canSwitch"
        :frontend-url="spaces.current?.url"
      />

      <EmptyState
        v-else-if="rows.length === 0"
        icon="doc"
        title="No content types yet"
        description="Create a content type under Content types; its page design shows up here."
      >
        <RouterLink to="/types/new" class="mb-btn-primary"><Icon name="plus" /> New content type</RouterLink>
      </EmptyState>

      <ul v-else class="ws:grid ws:gap-3 ws:md:grid-cols-2 ws:2xl:grid-cols-3">
        <DesignCard
          v-for="row in rows"
          :key="row.type.id"
          :to="designRoute('page', row.type.id) ?? '/design/pages'"
          :icon="typeIcon(row.type)"
          :title="row.type.label"
          :meta="`${plural(row.type.fields.length, 'field')}, layout: ${row.layout}`"
          :status="row.status"
          :open-label="`Open the page designer of ${row.type.label}`"
        >
          <template v-if="row.broken || row.unplaced" #badges>
            <span v-if="row.broken" class="mb-badge-danger" title="Elements show fields the content type no longer has">{{ plural(row.broken, 'broken binding') }}</span>
            <span v-if="row.unplaced" class="mb-badge-warn" title="Fields the page does not show">{{ plural(row.unplaced, 'field') }} not shown</span>
          </template>
        </DesignCard>
      </ul>
    </div>
  </PageState>
</template>
