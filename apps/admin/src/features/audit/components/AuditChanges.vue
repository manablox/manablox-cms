<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import { formatTimestamp } from '@manablox/admin-sdk/lib/format';
import { computed } from 'vue';
import { type AuditEntry, actionLabel, actorKindLabel, pretty, targetKindLabel } from '../model';

/** One entry in full: a summary, each field before and after, then the record's details. */
const props = defineProps<{ entry: AuditEntry }>();

/** The entry's actor and action details as label/value rows. */
const details = computed(() => {
  const rows: Array<{ label: string; value: string; mono?: boolean }> = [];
  const e = props.entry;
  if (e.actorId)
    rows.push({ label: `${actorKindLabel(e.actorKind)} id`, value: e.actorId, mono: true });
  if (e.targetId)
    rows.push({ label: `${targetKindLabel(e.targetKind)} id`, value: e.targetId, mono: true });
  for (const [key, value] of Object.entries(e.meta ?? {})) {
    if (value === null || value === undefined) continue;
    rows.push({ label: key, value: pretty(value), mono: typeof value !== 'string' });
  }
  for (const [key, value] of Object.entries(e.actorDetail ?? {})) {
    if (value === null || value === '') continue;
    rows.push({ label: key, value: pretty(value), mono: key !== 'userAgent' });
  }
  return rows;
});
</script>

<template>
  <div class="mb-surface-inset rounded-card p-3 text-xs">
    <p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span class="font-semibold">{{ actionLabel(entry.action) }}</span>
      <span class="text-surface-400">-</span>
      <span class="text-surface-600 dark:text-surface-300">{{ formatTimestamp(entry.at) }}</span>
      <span class="text-surface-400">-</span>
      <span class="font-mono text-2xs text-surface-500">{{ entry.action }}</span>
    </p>

    <div v-if="entry.changes.length" class="mt-3 overflow-x-auto">
      <table class="mb-table min-w-[28rem] border-separate border-spacing-0">
        <thead>
          <tr>
            <th class="mb-th w-44 pr-3" scope="col">Field</th>
            <th class="mb-th w-[calc(50%-5.5rem)] pr-3" scope="col">Before</th>
            <th class="mb-th" scope="col">After</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="change in entry.changes" :key="change.path" class="align-top [&>td]:border-t [&>td]:border-surface-200 dark:[&>td]:border-surface-800">
            <td class="py-1.5 pr-3 font-mono text-2xs font-medium break-all">{{ change.path }}</td>
            <td class="py-1.5 pr-3">
              <pre v-if="change.from !== undefined" class="max-h-40 overflow-auto rounded-control bg-danger-50 px-2 py-1 font-mono text-2xs break-all whitespace-pre-wrap text-danger-800 dark:bg-danger-500/10 dark:text-danger-200">{{ pretty(change.from) }}</pre>
              <span v-else class="text-surface-400">nothing</span>
            </td>
            <td class="py-1.5">
              <pre v-if="change.to !== undefined" class="max-h-40 overflow-auto rounded-control bg-ok-500/10 px-2 py-1 font-mono text-2xs break-all whitespace-pre-wrap text-ok-700 dark:bg-ok-500/15 dark:text-ok-500">{{ pretty(change.to) }}</pre>
              <span v-else class="text-surface-400">nothing</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else class="mt-2 text-surface-500">Nothing on the record changed; the action itself is the entry.</p>

    <dl class="mt-4 grid gap-x-8 gap-y-1 border-t border-surface-200 pt-3 sm:grid-cols-2 xl:grid-cols-3 dark:border-surface-800">
      <div v-for="row in details" :key="row.label" class="flex min-w-0 items-baseline gap-2">
        <dt class="w-24 shrink-0 truncate text-surface-500" :title="row.label">{{ row.label }}</dt>
        <dd class="min-w-0 break-all" :class="row.mono ? 'font-mono text-2xs' : ''">{{ row.value }}</dd>
      </div>
    </dl>

    <p class="mt-3 flex items-center gap-2 border-t border-surface-200 pt-2 font-mono text-2xs text-surface-400 dark:border-surface-800">
      <Icon name="lock" class="mb-icon-sm shrink-0" />
      <span class="shrink-0">#{{ entry.seq }}</span>
      <span class="min-w-0 truncate" :title="`hash ${entry.hash}\nprevious ${entry.prevHash ?? 'none'}`">{{ entry.hash }}</span>
    </p>
  </div>
</template>
