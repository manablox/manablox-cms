<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import IconButton from '@manablox/admin-sdk/components/ui/IconButton.vue';
import SegmentedControl from '@manablox/admin-sdk/components/ui/SegmentedControl.vue';
import { isProduction } from '@manablox/admin-sdk/features/environments/model';
import { activeEnvironment, environmentOf } from '@manablox/admin-sdk/lib/environment';
import { helpOpen, shortcutHint, toggleShortcutsHelp } from '@manablox/admin-sdk/lib/shortcuts';
import { useBreadcrumbStore } from '@manablox/admin-sdk/stores/breadcrumb';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { useUiStore } from '@manablox/admin-sdk/stores/ui';
import { useIsFetching, useIsMutating } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import AdminLinksMenu from '~/components/feature/AdminLinksMenu.vue';
import { sidePanelFor } from '~/components/layout/side-panels';
import PluginSlot from '~/components/PluginSlot';
import NotificationBell from '~/features/notifications/components/NotificationBell.vue';
import { isSectionActive } from '~/lib/sections';
import { useNavStore } from '~/stores/menu';

/** Top bar: breadcrumb, locale switch, shortcuts, help links, notifications and a site link. */
const spaces = useSpaceStore();
const menu = useNavStore();
const breadcrumb = useBreadcrumbStore();
const route = useRoute();
const ui = useUiStore();

const fetching = useIsFetching();
const mutating = useIsMutating();
const busy = computed(() => fetching.value + mutating.value > 0);

/** The side panel drawer toggle on small screens. */
const drawer = computed(() => (spaces.spaces.length ? sidePanelFor(route) : null));

const locales = computed(() => spaces.current?.locales ?? ['en']);

const section = computed(() => menu.items.find((item) => isSectionActive(route, item.to)));

/** Set by the page holding the open entity. */
const leaf = computed(() => breadcrumb.leaf);

/** The working environment, for plugin entries beside the site link. */
const environment = computed(() =>
  spaces.currentId
    ? {
        spaceId: spaces.currentId,
        machineName: environmentOf(spaces.currentId),
        id:
          activeEnvironment.value?.spaceId === spaces.currentId ? activeEnvironment.value.id : null,
      }
    : null,
);

/** The space's address in production; plugins show an environment's own elsewhere. */
const siteUrl = computed(() =>
  isProduction(environmentOf(spaces.currentId)) ? (spaces.current?.url ?? null) : null,
);

const host = computed(() => {
  try {
    return siteUrl.value ? new URL(siteUrl.value).host : null;
  } catch {
    return siteUrl.value;
  }
});
</script>

<template>
  <header class="relative flex h-14 shrink-0 items-center gap-2 border-b border-surface-200 bg-surface-0 px-3 sm:h-16 sm:gap-3 sm:px-6 dark:border-surface-800 dark:bg-surface-900">
    <div v-if="busy" class="mb-activity-bar" role="progressbar" aria-label="Loading" aria-busy="true" />
    <IconButton
      icon="menu"
      label="Open menu"
      size="md"
      icon-class="mb-icon-lg"
      class="-ml-1 lg:hidden"
      :aria-expanded="ui.navOpen"
      @click="ui.navOpen = true"
    />
    <!-- Not `mb-btn-icon`: that forces a square width and the label would overflow. -->
    <button
      v-if="drawer"
      class="mb-btn-ghost mb-btn-sm shrink-0 lg:hidden"
      :aria-label="`Open ${drawer.label.toLowerCase()}`"
      :aria-expanded="ui.panelOpen"
      @click="ui.panelOpen = true"
    >
      <Icon :name="drawer.icon" class="mb-icon" />
      <span class="text-xs">{{ drawer.label }}</span>
    </button>

    <nav aria-label="Breadcrumb" class="flex min-w-0 items-center gap-1.5 text-sm">
      <span class="hidden max-w-40 shrink-0 truncate text-surface-500 sm:inline">{{ spaces.current?.name ?? 'Manablox' }}</span>
      <template v-if="section">
        <Icon name="chevron" class="hidden mb-icon-sm shrink-0 text-surface-400 sm:block" />
        <RouterLink :to="section.to" class="max-w-40 truncate font-semibold hover:text-brand-600 sm:shrink-0" :class="leaf ? '' : 'text-surface-900 dark:text-surface-100'">
          {{ section.label }}
        </RouterLink>
      </template>
      <template v-if="leaf">
        <Icon name="chevron" class="mb-icon-sm shrink-0 text-surface-400" />
        <span class="truncate font-semibold text-surface-900 dark:text-surface-100" :title="leaf">{{ leaf }}</span>
      </template>
    </nav>

    <div class="flex-1" />

    <div v-if="locales.length > 1" class="flex items-center gap-2">
      <span class="hidden text-xs font-medium text-surface-500 md:inline">Language</span>
      <SegmentedControl
        v-model="spaces.locale"
        class="font-mono uppercase"
        :options="locales.map((code) => ({ value: code, label: code }))"
        aria-label="Locale"
      />
    </div>

    <IconButton
      icon="keyboard"
      label="Keyboard shortcuts"
      :title="shortcutHint('?', 'Keyboard shortcuts')"
      size="md"
      :aria-expanded="helpOpen"
      @click="toggleShortcutsHelp"
    />

    <AdminLinksMenu />

    <NotificationBell />

    <PluginSlot v-if="environment" id="environment.address" :props="{ environment }" />

    <a
      v-if="siteUrl"
      :href="siteUrl"
      target="_blank"
      rel="noreferrer"
      class="mb-btn-outline"
      :title="`Open ${host} in a new tab`"
      aria-label="Visit site"
    >
      <Icon name="external" class="mb-icon text-surface-500" />
      <span class="hidden sm:inline">Visit site</span>
    </a>
  </header>
</template>
