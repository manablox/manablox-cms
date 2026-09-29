<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import SortHeader from '@manablox/admin-sdk/components/ui/SortHeader.vue';
import { toggleInSet } from '@manablox/admin-sdk/lib/collections';
import {
  dayLabel,
  formatTime,
  formatTimestamp,
  relativeTime,
} from '@manablox/admin-sdk/lib/format';
import { computed, ref } from 'vue';
import {
  type AuditEntry,
  type AuditSortState,
  actionTone,
  actorIcon,
  actorKindLabel,
  actorTone,
  changedFields,
  outcome,
  SORT_FIELDS,
  targetKindLabel,
  targetRoute,
  verb,
} from '../model';
import AuditChanges from './AuditChanges.vue';

/** The log as an accordion list with day headings and sortable columns. */
const props = defineProps<{
  items: readonly AuditEntry[];
  sort: AuditSortState;
  /** Show each entry's space, for the instance-wide view. */
  showSpace?: boolean;
  spaceName?: ((spaceId: string | null) => string) | undefined;
}>();
const emit = defineEmits<{ sort: [by: AuditSortState['by']] }>();

const open = ref<Set<string>>(new Set());

const TONE: Record<ReturnType<typeof actionTone>, string> = {
  ok: 'mb-badge-ok',
  danger: 'mb-badge-danger',
  warn: 'mb-badge-warn',
  neutral: 'mb-badge',
};

/** Day headings only in time order. */
const byTime = computed(() => props.sort.by === 'at');
const dayOf = (entry: AuditEntry) => new Date(entry.at).toDateString();
const startsDay = (index: number) =>
  byTime.value &&
  (index === 0 ||
    dayOf(props.items[index] as AuditEntry) !== dayOf(props.items[index - 1] as AuditEntry));

/** Changed-field chips per entry, computed once per list. */
const summaries = computed(
  () => new Map(props.items.map((entry) => [entry.id, changedFields(entry)])),
);
const NO_CHANGES: ReturnType<typeof changedFields> = { chips: [], note: null };
const summaryOf = (entry: AuditEntry) => summaries.value.get(entry.id) ?? NO_CHANGES;

/** Column widths shared by header and rows. */
const WIDTHS: Record<AuditSortState['by'], string> = {
  at: 'w-24 shrink-0',
  actorLabel: 'w-52 shrink-0',
  action: 'min-w-0 flex-1',
  targetKind: '',
  targetLabel: '',
};
</script>

<template>
  <div>
    <div class="flex items-center gap-3 pr-7 pl-1" role="row">
      <SortHeader
        v-for="field in SORT_FIELDS"
        :key="field.value"
        tag="div"
        :by="field.value"
        :sort="sort"
        :label="field.label"
        :class="WIDTHS[field.value]"
        @sort="emit('sort', $event)"
      />
      <span v-if="showSpace" class="mb-th w-32 shrink-0 pb-2">Space</span>
    </div>

    <ul class="mb-list-divided">
      <template v-for="(entry, index) in items" :key="entry.id">
        <li v-if="startsDay(index)" class="pt-3 pb-1.5 pl-1">
          <span class="mb-eyebrow">{{ dayLabel(entry.at) }}</span>
        </li>
        <li>
          <button
            type="button"
            class="flex w-full items-start gap-3 py-2.5 pl-1 text-left"
            :aria-expanded="open.has(entry.id)"
            @click="open = toggleInSet(open, entry.id)"
          >
            <span :class="WIDTHS.at" class="pt-0.5">
              <span class="block text-xs font-medium tabular-nums" :title="formatTimestamp(entry.at)">
                {{ byTime ? formatTime(entry.at) : formatTimestamp(entry.at) }}
              </span>
              <span class="block text-2xs text-surface-500">{{ relativeTime(entry.at) }}</span>
            </span>

            <span :class="WIDTHS.actorLabel" class="flex items-center gap-2">
              <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-control" :class="actorTone(entry.actorKind)">
                <Icon :name="actorIcon(entry.actorKind)" class="mb-icon-sm" />
              </span>
              <span class="min-w-0">
                <span class="block truncate text-xs font-medium" :title="entry.actorLabel">{{ entry.actorLabel }}</span>
                <span class="block text-2xs text-surface-500">{{ actorKindLabel(entry.actorKind) }}</span>
              </span>
            </span>

            <span :class="WIDTHS.action">
              <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span class="mb-badge shrink-0" :class="TONE[actionTone(entry.action)]">{{ verb(entry.action) }}</span>
                <span v-if="outcome(entry)" class="shrink-0 text-xs font-semibold text-surface-600 dark:text-surface-300">{{ outcome(entry) }}</span>
                <span class="shrink-0 mb-meta">{{ targetKindLabel(entry.targetKind) }}</span>
                <RouterLink v-if="targetRoute(entry)" :to="targetRoute(entry) as string" class="min-w-0 max-w-full truncate text-sm font-medium hover:underline" @click.stop>
                  {{ entry.targetLabel || entry.targetId }}
                </RouterLink>
                <span v-else-if="entry.targetLabel || entry.targetId" class="min-w-0 max-w-full truncate text-sm font-medium">{{ entry.targetLabel || entry.targetId }}</span>
              </span>
              <span v-if="summaryOf(entry).chips.length || summaryOf(entry).note" class="mt-1 flex flex-wrap items-center gap-1">
                <span v-for="chip in summaryOf(entry).chips" :key="chip" class="rounded-control bg-surface-100 px-1.5 py-0.5 font-mono text-2xs text-surface-600 dark:bg-surface-800 dark:text-surface-400">{{ chip }}</span>
                <span v-if="summaryOf(entry).note" class="text-2xs text-surface-500">{{ summaryOf(entry).note }}</span>
              </span>
            </span>

            <span v-if="showSpace" class="w-32 shrink-0 truncate pt-0.5 mb-meta">{{ spaceName?.(entry.spaceId) ?? entry.spaceId ?? 'Instance' }}</span>

            <Icon name="down" class="mt-1 mb-icon shrink-0 text-surface-400 transition" :class="open.has(entry.id) ? 'rotate-180' : ''" />
          </button>

          <AuditChanges v-if="open.has(entry.id)" :entry="entry" class="mb-3" />
        </li>
      </template>
    </ul>
  </div>
</template>
