<script setup lang="ts">
import {
  confirmAndRun,
  formatDate,
  formatDateTime,
  relativeTime,
  runWrite,
} from '@manablox/admin-sdk';
import { computed, ref } from 'vue';
import type { LicenseKeyView } from '../../sdk';
import { KIND_LABELS, STATE_BADGES, STATE_HINTS } from '../model/states';
import { licenses } from '../queries';

/** One key: what it covers, its lease and the last call, with its actions unless `readOnly`. */
const props = defineProps<{ entry: LicenseKeyView; readOnly?: boolean }>();

const busy = ref(false);
const label = computed(() => props.entry.keyId);
const badge = computed(() => (props.entry.state ? STATE_BADGES[props.entry.state] : null));
const products = computed(() => props.entry.products.map((item) => item.label).join(', '));
/** Activating again: after a conflict, a deactivation or a failed first activation. */
const canActivate = computed(
  () => !props.entry.activated || props.entry.deactivated || props.entry.state === 'conflict',
);

const refresh = () =>
  runWrite(() => licenses.refresh(props.entry.id), {
    busy,
    success: `Refreshed ${label.value}`,
  });

const activate = () =>
  runWrite(() => licenses.activate(props.entry.id), {
    busy,
    success: `Activated ${label.value} here`,
  });

const deactivate = () =>
  confirmAndRun(
    {
      title: `Deactivate ${label.value}?`,
      message:
        'The license server frees its seat, and what it covers locks here until you activate it again.',
      confirmLabel: 'Deactivate',
      danger: true,
    },
    () => licenses.deactivate(props.entry.id),
    { busy, success: `Deactivated ${label.value}` },
  );

const remove = () =>
  confirmAndRun(
    {
      title: `Remove ${label.value}?`,
      message: 'Its activation is freed and the key is deleted from this instance.',
      confirmLabel: 'Remove key',
      danger: true,
    },
    () => licenses.remove(props.entry.id),
    { busy, success: `Removed ${label.value}` },
  );
</script>

<template>
  <li class="mb-list-item lic:flex-col lic:items-stretch lic:gap-2">
    <div class="lic:flex lic:flex-wrap lic:items-center lic:gap-2">
      <code class="lic:font-mono lic:text-sm lic:font-semibold">{{ entry.keyId }}</code>
      <span class="mb-badge" :title="entry.source === 'environment' ? 'Set in MANABLOX_LICENSE_KEYS; change it there.' : undefined">
        {{ entry.source === 'environment' ? 'from environment' : 'added here' }}
      </span>
      <span v-if="badge" :class="badge.badge">{{ badge.label }}</span>
      <span v-else-if="entry.deactivated" class="mb-badge">deactivated</span>
      <span v-else class="mb-badge">not active</span>
      <span
        v-if="entry.trialing && !entry.deactivated"
        class="mb-badge"
        :title="entry.periodEnd ? `The trial ends ${formatDate(entry.periodEnd)}` : undefined"
      >
        Trial{{ entry.periodEnd ? ` until ${formatDate(entry.periodEnd)}` : '' }}
      </span>
      <span v-if="entry.kind" class="mb-meta">{{ KIND_LABELS[entry.kind] }}</span>
      <div v-if="!readOnly" class="lic:ml-auto lic:flex lic:flex-wrap lic:gap-1.5">
        <button v-if="entry.activated" type="button" class="mb-btn-ghost mb-btn-sm" :disabled="busy" @click="refresh">
          Refresh now
        </button>
        <button v-if="canActivate" type="button" class="mb-btn-outline mb-btn-sm" :disabled="busy" @click="activate">
          Activate here
        </button>
        <button v-if="entry.activated" type="button" class="mb-btn-ghost-danger mb-btn-sm" :disabled="busy" @click="deactivate">
          Deactivate
        </button>
        <button v-if="entry.source === 'admin'" type="button" class="mb-btn-ghost-danger mb-btn-sm" :disabled="busy" @click="remove">
          Remove
        </button>
      </div>
    </div>

    <dl class="lic:grid lic:grid-cols-2 lic:gap-x-6 lic:gap-y-1 lic:text-xs lic:sm:grid-cols-4">
      <div>
        <dt class="mb-meta">Covers</dt>
        <dd>{{ products || 'Nothing yet' }}</dd>
      </div>
      <div>
        <dt class="mb-meta">{{ entry.trialing ? 'Trial ends' : 'Period ends' }}</dt>
        <dd>{{ entry.periodEnd ? formatDate(entry.periodEnd) : '-' }}</dd>
      </div>
      <div>
        <dt class="mb-meta">Lease runs out</dt>
        <dd>{{ entry.leaseExpiresAt ? formatDateTime(entry.leaseExpiresAt) : '-' }}</dd>
      </div>
      <div>
        <dt class="mb-meta">Last refresh</dt>
        <dd>{{ entry.refreshedAt ? relativeTime(entry.refreshedAt) : 'Never' }}</dd>
      </div>
    </dl>

    <p v-if="entry.state && entry.state !== 'active'" class="mb-hint">{{ STATE_HINTS[entry.state] }}</p>
    <div v-if="entry.error" class="mb-callout lic:text-xs">
      <p class="mb-text-danger">{{ entry.error.message }}</p>
      <ul v-if="entry.error.activations?.length" class="lic:mt-1 lic:list-disc lic:pl-4">
        <li v-for="holder in entry.error.activations" :key="holder.id">
          {{ holder.name || holder.hostnames.join(', ') || holder.id }}
          <span v-if="holder.lastSeenAt" class="mb-meta">, seen {{ relativeTime(holder.lastSeenAt) }}</span>
        </li>
      </ul>
    </div>
  </li>
</template>
