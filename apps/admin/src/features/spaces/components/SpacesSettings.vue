<script setup lang="ts">
import FeatureGate from '@manablox/admin-sdk/components/feature/FeatureGate.vue';
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import EmptyState from '@manablox/admin-sdk/components/ui/EmptyState.vue';
import NewButton from '@manablox/admin-sdk/components/ui/NewButton.vue';
import Panel from '@manablox/admin-sdk/components/ui/Panel.vue';
import StatusBadge from '@manablox/admin-sdk/components/ui/StatusBadge.vue';
import { type FeatureState, showLocked } from '@manablox/admin-sdk/lib/features';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { importStateOf } from '../import-state';
import type { Space } from '../queries';
import ImportSpaceDialog from './ImportSpaceDialog.vue';
import SpaceCreateDialog from './SpaceCreateDialog.vue';

/** Settings -> Spaces: every space the viewer reaches; a row opens that space's settings. */
const spaces = useSpaceStore();
const session = useSessionStore();
const route = useRoute();
const router = useRouter();

const creating = ref(false);
/** Preselect the basic template. */
const creatingStarter = ref(false);
const importing = ref(false);
const note = ref<string | null>(null);

const createFeature = computed(() => session.feature('spaceCreate', null));
const importFeature = computed(() => session.feature('transferImport', null));

/** A switched-off feature opens the locked notice instead. */
function allowed(feature: 'spaceCreate' | 'transferImport', state: FeatureState): boolean {
  if (state.enabled) return true;
  if (state.locked) showLocked({ feature, message: state.message, link: state.link });
  return false;
}

function openCreate(starter = false) {
  if (!allowed('spaceCreate', createFeature.value)) return;
  creatingStarter.value = starter;
  creating.value = true;
}

function openImport() {
  if (!allowed('spaceCreate', createFeature.value)) return;
  if (!allowed('transferImport', importFeature.value)) return;
  importing.value = true;
}

// `?new=space`, `&setup=basic` and `?import=space` open a dialog once; the query is then dropped.
onMounted(() => {
  if (route.query.new === 'space') openCreate(route.query.setup === 'basic');
  else if (route.query.import === 'space') openImport();
  else return;
  void router.replace({ path: route.path, query: { tab: 'spaces' } });
});

const importTitle = (space: Space): string => {
  const state = importStateOf(space);
  return state ? `${state.step}, ${state.percent}%` : '';
};
</script>

<template>
  <Panel
    title="Spaces"
    description="Each space is a site or channel with its own content, languages and assets. Open one to change its settings; it becomes the space you work in."
    size="lg"
    :card="false"
  >
    <template v-if="session.isSuperadmin" #actions>
      <div class="flex shrink-0 flex-wrap gap-2">
        <FeatureGate v-if="!createFeature.hidden" feature="transferImport" instance label="Import" trigger-class="mb-btn-outline">
          <FeatureGate feature="spaceCreate" instance label="Import" trigger-class="mb-btn-outline">
            <button type="button" class="mb-btn-outline" @click="importing = true">
              <Icon name="upload" /> Import
            </button>
          </FeatureGate>
        </FeatureGate>
        <FeatureGate feature="spaceCreate" instance label="New space" trigger-class="mb-btn-primary">
          <NewButton label="New space" @click="openCreate()" />
        </FeatureGate>
      </div>
    </template>

    <ul v-if="spaces.spaces.length" class="mb-card mb-list-divided p-0">
      <li v-for="space in spaces.spaces" :key="space.id">
        <RouterLink
          :to="`/settings?space=${space.id}`"
          class="group flex items-center gap-3 px-4 py-3 transition hover:bg-surface-50 dark:hover:bg-surface-800/60"
        >
          <span class="mb-surface-inset flex h-9 w-9 shrink-0 items-center justify-center rounded-card text-surface-500">
            <Icon name="globe" class="mb-icon" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium group-hover:text-brand-700 dark:group-hover:text-brand-200">{{ space.name }}</span>
            <span class="block truncate font-mono text-2xs text-surface-500">{{ space.machineName }}</span>
          </span>
          <StatusBadge v-if="space.importStatus" :status="space.importStatus" :title="importTitle(space)" />
          <span v-if="space.id === spaces.currentId" class="mb-badge-brand">Current</span>
          <span v-if="session.roleIn(space.id)" class="mb-badge hidden sm:inline-flex">{{ session.roleIn(space.id) }}</span>
          <Icon name="chevron" class="mb-icon-sm shrink-0 text-surface-400" />
        </RouterLink>
      </li>
    </ul>

    <EmptyState
      v-else
      icon="globe"
      title="No spaces yet"
      :description="session.isSuperadmin ? 'Create one to start, or import one exported from another instance.' : 'Ask an administrator to add you to a space.'"
    >
      <div v-if="session.isSuperadmin" class="flex flex-wrap justify-center gap-2">
        <FeatureGate feature="spaceCreate" instance label="New space" trigger-class="mb-btn-primary">
          <button class="mb-btn-primary" @click="openCreate()"><Icon name="plus" /> New space</button>
          <button class="mb-btn-outline" @click="openCreate(true)">Start with the basic setup</button>
        </FeatureGate>
      </div>
    </EmptyState>

    <p v-if="note" class="mb-hint mt-3">{{ note }}</p>

    <SpaceCreateDialog v-if="creating" :starter="creatingStarter" @close="creating = false" />
    <ImportSpaceDialog v-if="importing" @close="importing = false" @imported="note = $event" />
  </Panel>
</template>
