<script setup lang="ts">
import {
  EmptyState,
  FeatureLock,
  formatDateTime,
  Icon,
  PageHeader,
  PageState,
  plural,
  relativeTime,
  useSpaceStore,
} from '@manablox/admin-sdk';
import { computed } from 'vue';
import DesignAreaCards from '../components/DesignAreaCards.vue';
import DesignChecklist from '../components/DesignChecklist.vue';
import DesignList from '../components/DesignList.vue';
import PaneSection from '../components/PaneSection.vue';
import SiteModePanel from '../components/SiteModePanel.vue';
import ThemeTransferActions from '../components/ThemeTransferActions.vue';
import { isDirty } from '../model/status';
import { useSiteDesigns } from '../queries';
import { useDesignActions } from '../useDesignActions';
import { useSiteContext } from '../useSiteContext';

/** The `/design` landing: where the site stands, its parts, first steps and publishing. */
const spaces = useSpaceStore();
const site = useSiteContext();
const {
  settings,
  domains,
  designed,
  canRead,
  canWrite,
  canPublish,
  canSwitch,
  liveOrigin,
  canvasOrigin,
  designLocked,
} = site;
const designs = useSiteDesigns();
const actions = useDesignActions();
const { publishing, previewing } = actions;

const all = computed(() => designs.data.value ?? []);
const dirty = computed(() => all.value.filter((entry) => isDirty(entry.status)));
const lastPublish = computed(() => {
  const times = all.value
    .map((entry) => (entry.publishedAt ? new Date(entry.publishedAt).getTime() : 0))
    .filter(Boolean);
  return times.length ? new Date(Math.max(...times)) : null;
});
const revision = computed(() => settings.data.value?.revision ?? 0);
/** Share links need a host the site maps to the space. */
const previewOrigin = computed(() => liveOrigin.value ?? canvasOrigin.value);
const liveHost = computed(() => (liveOrigin.value ? new URL(liveOrigin.value).host : null));

/** The one sentence on top: can visitors see the site, and is it up to date. */
const standing = computed(() => {
  if (revision.value === 0)
    return {
      icon: 'rocket',
      tone: 'mb-tile-ochre',
      title: 'Your site is not published yet',
      text: 'Everything you design stays a draft until you publish it. Until then visitors see nothing.',
    };
  if (!liveOrigin.value)
    return {
      icon: 'globe',
      tone: 'mb-tile-ochre',
      title: 'Published, but nobody can reach it yet',
      text: 'Add a domain so visitors have an address to open.',
    };
  return {
    icon: 'circle-check',
    tone: 'mb-tile-iris',
    title: 'Your site is live',
    text: dirty.value.length
      ? 'Visitors see the last published version. Your newer changes are waiting below.'
      : 'Visitors see everything you designed.',
  };
});
</script>

<template>
  <PageState :loading="settings.isPending.value" :error="settings.error.value" :retry="settings.refetch" loading-label="Loading the site...">
    <div class="mb-page">
      <PageHeader
        title="Design"
        description="Everything about how your website looks. Pick a part below to change it; your changes stay drafts until you publish them."
      >
        <template v-if="designed && canRead">
          <FeatureLock v-if="designLocked" feature="plugins.website.design" label="Designing is locked" />
          <a v-if="liveOrigin" :href="liveOrigin" target="_blank" rel="noopener" class="mb-btn-outline">
            <Icon name="external" /> Open site
          </a>
          <button
            v-if="previewOrigin"
            type="button"
            class="mb-btn-outline"
            :disabled="previewing"
            title="Opens the site with every draft applied; the link works for a day"
            @click="actions.previewDrafts(previewOrigin)"
          >
            <Icon name="eye" /> Preview drafts
          </button>
          <button v-if="canPublish" type="button" class="mb-btn-primary" :disabled="publishing || dirty.length === 0" @click="actions.publishAll">
            <Icon name="upload" /> {{ publishing ? 'Publishing...' : dirty.length ? `Publish all (${dirty.length})` : 'All published' }}
          </button>
        </template>
      </PageHeader>

      <EmptyState
        v-if="!canRead"
        icon="lock"
        title="No access to the design"
        description="Someone who manages this space's roles can give you design rights."
      />

      <template v-else-if="spaces.currentId && settings.data.value">
        <SiteModePanel
          v-if="!designed"
          :space-id="spaces.currentId"
          :mode="settings.data.value.mode"
          :can-switch="canSwitch"
          :frontend-url="spaces.current?.url"
        />

        <div v-else class="ws:space-y-6">
          <section class="mb-card ws:flex ws:flex-wrap ws:items-center ws:gap-4" aria-label="Site status">
            <span class="ws:flex ws:h-12 ws:w-12 ws:shrink-0 ws:items-center ws:justify-center ws:rounded-card" :class="standing.tone">
              <Icon :name="standing.icon" class="mb-icon-lg" />
            </span>
            <div class="ws:min-w-0 ws:flex-[1_1_18rem] ws:space-y-1">
              <h2 class="ws:font-display ws:text-lg ws:font-bold">{{ standing.title }}</h2>
              <p class="ws:text-sm ws:text-surface-600 ws:dark:text-surface-400">{{ standing.text }}</p>
              <p class="ws:flex ws:flex-wrap ws:gap-x-3 ws:gap-y-0.5 mb-meta">
                <a v-if="liveOrigin" :href="liveOrigin" target="_blank" rel="noopener" class="ws:font-mono ws:hover:underline">{{ liveHost }}</a>
                <span v-if="lastPublish" :title="formatDateTime(lastPublish)">Last published {{ relativeTime(lastPublish) }}</span>
                <span v-if="dirty.length" class="ws:text-warn-700 ws:dark:text-warn-300">{{ plural(dirty.length, 'change') }} not published</span>
              </p>
            </div>
            <RouterLink v-if="!liveOrigin" to="/settings?tab=apiHosts" class="mb-btn-outline"><Icon name="globe" /> Add a domain</RouterLink>
          </section>

          <div class="ws:grid ws:gap-6 ws:xl:grid-cols-[minmax(0,1fr)_22rem]">
            <section class="ws:min-w-0 ws:space-y-3" aria-labelledby="design-parts">
              <div>
                <h2 id="design-parts" class="ws:text-base ws:font-bold">Parts of your site</h2>
                <p class="ws:text-sm ws:text-surface-500">Each part starts with an automatic design built from your content types. Open one to make it your own.</p>
              </div>
              <DesignAreaCards :designs="all" />
            </section>
            <DesignChecklist :designs="all" :domain-count="domains.data.value?.length ?? 0" :revision="revision" />
          </div>

          <section v-if="dirty.length" class="ws:space-y-3" aria-labelledby="design-waiting">
            <div>
              <h2 id="design-waiting" class="ws:text-base ws:font-bold">Waiting to be published</h2>
              <p class="ws:text-sm ws:text-surface-500">Visitors do not see these changes yet. Publish one at a time, or all at once with Publish all.</p>
            </div>
            <div class="mb-card">
              <DesignList :space-id="spaces.currentId" :query="designs" :can-write="canWrite" :can-publish="canPublish" only="dirty" />
            </div>
          </section>

          <div class="mb-card ws:space-y-1 ws:py-2">
            <PaneSection id="overview-all" title="Every design, with versions and resets" icon="list" :default-open="false">
              <DesignList :space-id="spaces.currentId" :query="designs" :can-write="canWrite" :can-publish="canPublish" />
            </PaneSection>
            <PaneSection id="overview-files" title="Theme gallery, import and export" icon="download" :default-open="false">
              <p class="mb-meta">Start over from a ready-made theme, or move a whole design between spaces as a file.</p>
              <ThemeTransferActions :space-id="spaces.currentId" :space-name="spaces.current?.name ?? ''" :can-write="canWrite" />
            </PaneSection>
            <PaneSection id="overview-mode" title="Website mode" icon="settings" :default-open="false">
              <SiteModePanel :space-id="spaces.currentId" :mode="settings.data.value.mode" :can-switch="canSwitch" />
            </PaneSection>
          </div>
        </div>
      </template>
    </div>
  </PageState>
</template>
