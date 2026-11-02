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
  type BlockDesign,
  findBrokenBindings,
  findUnplacedFields,
  generateBlockDesign,
} from '@manablox/site';
import { computed } from 'vue';
import DesignCard from '../components/DesignCard.vue';
import SiteModePanel from '../components/SiteModePanel.vue';
import { designRoute, STATUS_META } from '../model/status';
import { useDesignsData, useSiteDesigns } from '../queries';
import { useSiteContext } from '../useSiteContext';

/** `/design/blocks`: every block type with its design's status and warnings. */
const spaces = useSpaceStore();
const site = useSiteContext();
const { settings, designed, canRead, canSwitch } = site;
const designs = useSiteDesigns();

const summaries = computed(
  () =>
    new Map(
      (designs.data.value ?? [])
        .filter((entry) => entry.kind === 'block')
        .map((entry) => [entry.key, entry]),
    ),
);
const storedKeys = computed(() =>
  [...summaries.value.values()].filter((entry) => entry.id !== null).map((entry) => entry.key),
);
const stored = useDesignsData('block', storedKeys);

const rows = computed(() =>
  spaces.blockKinds.map((type) => {
    const summary = summaries.value.get(type.id);
    const data = stored.data.value?.[type.id] as BlockDesign | null | undefined;
    const design = data ?? generateBlockDesign(type);
    const unplaced = findUnplacedFields(design, type).length;
    const broken = findBrokenBindings(design, type).length;
    return {
      type,
      status: summary?.status ?? 'generated',
      variants: Object.keys(design.variants).length,
      unplaced,
      broken,
    };
  }),
);
</script>

<template>
  <PageState :loading="settings.isPending.value" :error="settings.error.value" :retry="settings.refetch" loading-label="Loading the block designs...">
    <div class="mb-page">
      <PageHeader title="Block designs" description="Blocks are the sections editors stack on a page, like a hero or a teaser. Design each one once and it looks the same everywhere. Until you do, a block shows its fields top to bottom." />

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
        icon="blocks"
        title="No block types yet"
        description="Create a block type under Content types; its design shows up here."
      >
        <RouterLink to="/types/new?kind=block" class="mb-btn-primary"><Icon name="plus" /> New block type</RouterLink>
      </EmptyState>

      <ul v-else class="ws:grid ws:gap-3 ws:md:grid-cols-2 ws:2xl:grid-cols-3">
        <DesignCard
          v-for="row in rows"
          :key="row.type.id"
          :to="designRoute('block', row.type.id) ?? '/design/blocks'"
          :icon="typeIcon(row.type)"
          :title="row.type.label"
          :meta="`${plural(row.type.fields.length, 'field')}, ${plural(row.variants, 'variant')}`"
          :status="row.status"
          :open-label="`Open the designer of ${row.type.label}`"
        >
          <template v-if="row.broken || row.unplaced" #badges>
            <span v-if="row.broken" class="mb-badge-danger" title="Elements show fields the block type no longer has">{{ plural(row.broken, 'broken binding') }}</span>
            <span v-if="row.unplaced" class="mb-badge-warn" title="Fields no variant shows">{{ plural(row.unplaced, 'field') }} not shown</span>
          </template>
        </DesignCard>
      </ul>
    </div>
  </PageState>
</template>
