<script setup lang="ts">
import { AsyncList, formatDateTime, Icon, IconButton, relativeTime } from '@manablox/admin-sdk';
import type { UseQueryReturnType } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { designRoute, isDirty, KIND_SECTIONS, STATUS_META } from '../model/status';
import type { SiteDesignSummary } from '../queries';
import { useDesignActions } from '../useDesignActions';
import DesignVersionsDialog from './DesignVersionsDialog.vue';

/** Every design of the space by kind, with its status and per-design actions. */
const props = defineProps<{
  spaceId: string;
  query: UseQueryReturnType<SiteDesignSummary[], Error>;
  canWrite: boolean;
  canPublish: boolean;
  /** `dirty` lists only designs with changes to publish. */
  only?: 'dirty' | undefined;
}>();

const actions = useDesignActions();
const { busyId } = actions;

type Stored = SiteDesignSummary & { id: string };
const stored = (entry: SiteDesignSummary): entry is Stored => entry.id !== null;

const sections = computed(() =>
  KIND_SECTIONS.map((section) => ({
    ...section,
    items: (props.query.data.value ?? []).filter(
      (entry) => entry.kind === section.kind && (props.only !== 'dirty' || isDirty(entry.status)),
    ),
  })).filter((section) => section.items.length > 0),
);

const history = ref<Stored | null>(null);
</script>

<template>
  <AsyncList
    :pending="query.isPending.value"
    :error="query.error.value"
    :retry="query.refetch"
    :items="query.data.value"
    empty-icon="palette"
    empty-title="Nothing to design yet"
  >
    <template #default>
      <div class="ws:space-y-4" :class="only ? '' : 'mb-card'">
        <section v-for="section in sections" :key="section.kind" class="ws:space-y-1">
          <h2 class="ws:mb-2 ws:flex ws:items-center ws:gap-2 ws:text-sm ws:font-bold">
            <Icon :name="section.icon" class="mb-icon ws:text-surface-400" />
            {{ section.label }}
            <span class="ws:text-xs ws:font-normal ws:text-surface-500">{{ section.items.length }}</span>
            <RouterLink v-if="!only && section.kind !== 'theme' && section.kind !== 'site'" :to="designRoute(section.kind) ?? '/design'" class="ws:ml-auto ws:text-xs ws:font-normal ws:text-brand-600 ws:hover:underline ws:dark:text-brand-400">
              Open the list
            </RouterLink>
          </h2>
          <ul class="mb-list-divided">
            <li v-for="entry in section.items" :key="`${entry.kind}:${entry.key}`" class="group ws:flex ws:flex-wrap ws:items-center ws:gap-x-3 ws:gap-y-1 ws:py-2">
              <div class="ws:min-w-0 ws:flex-1">
                <component
                  :is="designRoute(entry.kind, entry.key) ? 'RouterLink' : 'span'"
                  :to="designRoute(entry.kind, entry.key) ?? undefined"
                  class="ws:block ws:truncate ws:text-sm ws:font-medium"
                  :class="designRoute(entry.kind, entry.key) ? 'ws:hover:underline' : ''"
                >
                  {{ entry.label }}
                </component>
                <span class="ws:block ws:truncate ws:text-2xs ws:text-surface-500">
                  <template v-if="entry.updatedAt">
                    changed <span :title="formatDateTime(entry.updatedAt)">{{ relativeTime(entry.updatedAt) }}</span>
                  </template>
                  <template v-else>{{ STATUS_META[entry.status].hint }}</template>
                </span>
              </div>
              <span v-if="entry.orphaned" class="mb-badge-danger" title="Its content type was deleted; the site no longer uses it">orphaned</span>
              <span :class="STATUS_META[entry.status].tone" :title="STATUS_META[entry.status].hint">{{ STATUS_META[entry.status].label }}</span>
              <div v-if="stored(entry)" class="ws:flex ws:items-center ws:gap-0.5">
                <button
                  v-if="canPublish && isDirty(entry.status)"
                  type="button"
                  class="mb-btn-ghost mb-btn-sm"
                  :disabled="busyId === entry.id"
                  :aria-label="`Publish ${entry.label}`"
                  title="Publish only this design"
                  @click="actions.publish(entry)"
                >
                  <Icon name="upload" class="mb-icon-sm" /> Publish
                </button>
                <IconButton icon="clock" :label="`Versions of ${entry.label}`" title="Versions" @click="history = entry" />
                <IconButton
                  v-if="canWrite && isDirty(entry.status)"
                  icon="undo"
                  :label="`Discard the draft of ${entry.label}`"
                  title="Discard draft"
                  @click="actions.discard(entry)"
                />
                <IconButton
                  v-if="canPublish"
                  icon="reset"
                  :label="`Reset ${entry.label} to the automatic design`"
                  title="Start over with the automatic design"
                  danger
                  @click="actions.reset(entry)"
                />
              </div>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </AsyncList>

  <DesignVersionsDialog
    v-if="history"
    :space-id="spaceId"
    :summary="history"
    :can-restore="canWrite"
    @close="history = null"
  />
</template>
