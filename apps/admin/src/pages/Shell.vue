<script setup lang="ts">
import Loader from '@manablox/admin-sdk/components/ui/Loader.vue';
import { usePanel } from '@manablox/admin-sdk/composables/usePanel';
import { useEnvironmentSync } from '@manablox/admin-sdk/features/environments/useEnvironment';
import { environmentOf } from '@manablox/admin-sdk/lib/environment';
import { messageFor } from '@manablox/admin-sdk/lib/messages';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { useUiStore } from '@manablox/admin-sdk/stores/ui';
import { useEventListener } from '@vueuse/core';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterView, useRoute } from 'vue-router';
import ControlBanners from '~/components/feature/ControlBanners.vue';
import FeatureLocked from '~/components/feature/FeatureLocked.vue';
import Logo from '~/components/Logo.vue';
import { SIDE_PANELS, type SidePanelKey, sidePanelFor } from '~/components/layout/side-panels';
import PanelColumn from '~/components/PanelColumn.vue';
import Sidebar from '~/components/Sidebar.vue';
import Topbar from '~/components/Topbar.vue';
import { type ActivePanel, useGlobalShortcuts } from '~/composables/useGlobalShortcuts';
import { usePinnedLeave } from '~/composables/usePinnedLeave';
import EnvironmentBar from '~/features/environments/components/EnvironmentBar.vue';
import SpaceImportNotice from '~/features/spaces/components/SpaceImportNotice.vue';
import UsageBanner from '~/features/usage/components/UsageBanner.vue';
import { connect as connectRealtime, disconnect as disconnectRealtime } from '~/lib/realtime';

const spaces = useSpaceStore();
const session = useSessionStore();
const route = useRoute();
const ui = useUiStore();

useEnvironmentSync();
/** Pages and side lists remount on a switch, so nothing shows another environment's rows. */
const environment = computed(() => environmentOf(spaces.currentId));

// Close drawers on navigation.
watch(
  () => route.fullPath,
  () => ui.closeDrawers(),
);

/** A link in the panel drawer closes it, even one to the current route. */
function closeOnLink(event: MouseEvent) {
  if ((event.target as Element | null)?.closest('a[href]')) ui.panelOpen = false;
}

// The empty state replaces the page; settings opts out so the first space can be created.
const needsSpace = computed(() => route.meta.needsSpace !== false);

/** An unfinished import replaces the space's pages; settings stays open to resume or delete it. */
const importPending = computed(() => spaces.currentImporting && needsSpace.value);

/** The route's first switched-off feature; its panel stands in for the page. */
const blocked = computed(() => {
  for (const key of route.meta.features ?? []) {
    const state = session.feature(key, spaces.currentId);
    if (!state.enabled) return { key, state };
  }
  return null;
});

/** The route's side list; none until a space exists, while it imports, or while its section is off. */
const sectionOff = computed(() => blocked.value?.key === route.meta.features?.[0]);
const panel = computed(() =>
  spaces.spaces.length > 0 && !importPending.value && !(blocked.value && sectionOff.value)
    ? sidePanelFor(route)
    : null,
);

// Each column remembers its collapsed state; collapsed shows a rail.
const panelStates = new Map(
  Object.keys(SIDE_PANELS).map((key) => [key as SidePanelKey, usePanel(key as SidePanelKey)]),
);
/** A plugin panel's state is created on first use. */
function stateOf(key: SidePanelKey): ReturnType<typeof usePanel> {
  let state = panelStates.get(key);
  if (!state) {
    state = usePanel(key);
    panelStates.set(key, state);
  }
  return state;
}
const panelState = computed(() => (panel.value ? stateOf(panel.value.key) : null));

/** For the `]` shortcut and the help dialog. */
const activePanel = computed<ActivePanel | null>(() => {
  if (!panel.value || !panelState.value) return null;
  return {
    label: panel.value.label,
    collapsed: panelState.value.collapsed.value,
    toggle: panelState.value.toggle,
  };
});

useGlobalShortcuts(activePanel);

// Bootstrap failures are surfaced with a retry, not rendered as an empty instance.
const loadError = ref<string | null>(null);
// The page must not render before boot: it would consume its query (`?new=space`) and then be remounted.
const booted = ref(false);

function reload(): void {
  loadError.value = null;
  spaces
    .load()
    .catch((error) => {
      loadError.value = messageFor(error);
    })
    .finally(() => {
      booted.value = true;
    });
}

onMounted(() => {
  reload();
  // Live feed of others' saves.
  connectRealtime();
});
onBeforeUnmount(disconnectRealtime);

const { main, pin: pinLeaving } = usePinnedLeave();

// Controls can change at runtime.
useEventListener(window, 'focus', () => void session.revalidate());
</script>

<template>
  <div class="flex h-full">
    <!-- Drawer backdrop under `lg`. -->
    <Transition enter-active-class="mb-fade-enter-active" leave-active-class="mb-fade-leave-active">
      <div
        v-if="ui.navOpen"
        class="mb-backdrop mb-z-drawer fixed inset-0 lg:hidden"
        aria-hidden="true"
        @click="ui.navOpen = false"
      />
    </Transition>
    <Sidebar />
    <div class="flex min-w-0 flex-1 flex-col">
      <EnvironmentBar />
      <Topbar />
      <ControlBanners />
      <UsageBanner />
      <div class="flex min-h-0 flex-1">
        <!-- Wide: side column. -->
        <div v-if="panel && panelState" class="hidden lg:contents">
          <PanelColumn
            :key="`${panel.key}:${environment}`"
            :collapsed="panelState.collapsed.value"
            :label="panel.label"
            :resize="panel.key"
            @expand="panelState.toggle()"
          >
            <component :is="panel.component" v-bind="panel.props" />
          </PanelColumn>
        </div>
        <!-- Narrow: the same panel as a drawer. -->
        <Transition
          :duration="{ enter: 200, leave: 140 }"
          enter-active-class="mb-drawer-enter-active"
          leave-active-class="mb-drawer-leave-active"
        >
          <div v-if="ui.panelOpen && panel" class="mb-z-drawer fixed inset-0 flex lg:hidden">
            <div class="mb-backdrop absolute inset-0" aria-hidden="true" @click="ui.panelOpen = false" />
            <div class="mb-drawer-panel relative flex h-full max-w-[85vw] shadow-modal [&>aside]:w-[13.6rem] [&>aside]:max-w-full [&>aside]:bg-surface-50 dark:[&>aside]:bg-surface-900" @click="closeOnLink">
              <component :is="panel.component" :key="environment" v-bind="panel.props" />
            </div>
          </div>
        </Transition>

        <!-- Positioned so absolute children stay inside the scroller. -->
        <main ref="main" class="relative min-h-0 flex-1 overflow-auto">
          <div v-if="spaces.loading || !booted" class="flex h-full items-center justify-center gap-3 text-sm text-surface-500">
            <Logo :size="28" />
            <Loader />
          </div>

          <div v-else-if="loadError" class="p-8">
            <div class="mb-card mx-auto max-w-lg text-center">
              <h2 class="text-lg font-bold">Could not load this instance</h2>
              <p class="mt-2 text-sm text-surface-500">{{ loadError }}</p>
              <button class="mb-btn-primary mt-4" @click="reload">Try again</button>
            </div>
          </div>

          <div v-else-if="spaces.spaces.length === 0 && needsSpace" class="flex h-full items-center justify-center p-8">
            <div class="max-w-md text-center">
              <Logo :size="96" class="mx-auto" />
              <p class="mb-eyebrow mt-6">Welcome</p>
              <h2 class="mb-title mt-1">Start with a space</h2>
              <p class="mt-3 text-sm text-surface-500">
                A space is a site or channel with its own content tree, locales and assets.
                Everything in Manablox lives inside one.
              </p>
              <!-- The query opens the create or import dialog directly. -->
              <div v-if="session.isSuperadmin" class="mt-6 flex flex-wrap justify-center gap-2">
                <RouterLink to="/settings?new=space" class="mb-btn-primary">
                  Create your first space
                </RouterLink>
                <RouterLink to="/settings?new=space&setup=basic" class="mb-btn-outline">
                  Start with the basic setup
                </RouterLink>
                <RouterLink to="/settings?import=space" class="mb-btn-outline">
                  Import a space
                </RouterLink>
              </div>
              <p v-if="session.isSuperadmin" class="mt-3 mb-meta">
                The basic setup comes with page and article types, a few published pages
                and a main menu, so there is a site to look at right away. Importing
                restores a space exported from another instance, asset files included.
              </p>
              <p v-else class="mt-6 text-sm text-surface-500">
                Ask an administrator to add you to a space.
              </p>
            </div>
          </div>

          <div v-else-if="importPending && spaces.current" class="mb-page-narrow">
            <SpaceImportNotice :space="spaces.current" />
          </div>

          <div v-else-if="blocked" class="mb-page-narrow">
            <FeatureLocked :feature="blocked.key" :state="blocked.state" />
          </div>

          <!-- Keyed by environment only: shared-component routes keep their instance. -->
          <RouterView v-else v-slot="{ Component }">
            <Transition name="page" mode="out-in" @before-leave="pinLeaving">
              <component :is="Component" :key="environment" />
            </Transition>
          </RouterView>
        </main>
      </div>
    </div>
  </div>
</template>
