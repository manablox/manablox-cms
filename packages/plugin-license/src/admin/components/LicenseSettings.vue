<script setup lang="ts">
import {
  AsyncList,
  formatDate,
  Icon,
  NewButton,
  SettingsBlock,
  SettingsPage,
} from '@manablox/admin-sdk';
import { computed, ref } from 'vue';
import { KIND_LABELS, STATE_BADGES, STATE_HINTS } from '../model/states';
import { useLicenseOverview } from '../queries';
import LicenseKeyDialog from './LicenseKeyDialog.vue';
import LicenseKeyRow from './LicenseKeyRow.vue';

/** Settings → Licenses: the premium products, the instance's keys, and the portal. */
const { data, isPending, error, refetch } = useLicenseOverview();
const adding = ref(false);

const products = computed(() => data.value?.products ?? []);
const keys = computed(() => data.value?.keys);
/** Hosted keys only: Manablox Cloud manages them, so nothing changes here. */
const managed = computed(() => data.value?.managed === true);
</script>

<template>
  <SettingsPage
    title="Licenses"
    description="Premium plugins need a license key. Keys from MANABLOX_LICENSE_KEYS are read-only here; keys added here are stored encrypted in the database. The instance checks its leases offline and refreshes them once a day."
  >
    <template v-if="!managed" #actions>
      <a
        v-if="data"
        class="mb-btn-outline"
        :href="data.portal"
        target="_blank"
        rel="noopener"
      >
        Buy or manage
        <Icon name="external" class="mb-icon-sm" />
      </a>
      <NewButton label="Add key" @click="adding = true" />
    </template>

    <div v-if="managed" class="mb-callout lic:flex lic:items-center lic:gap-2">
      <Icon name="cloud" class="mb-icon" />
      <p><span class="lic:font-semibold">Managed by Manablox Cloud.</span> This instance's licenses come with its plan and change with it.</p>
    </div>

    <SettingsBlock
      title="Premium plugins"
      description="What the configured premium plugins may do now, over every key."
    >
      <p v-if="data && !products.length" class="mb-hint">
        No premium plugin is configured on this instance.
      </p>
      <ul v-else class="mb-list mb-list-divided mb-card">
        <li v-for="product in products" :key="product.product" class="mb-list-item lic:flex-wrap lic:gap-2">
          <span class="lic:font-semibold">{{ product.label }}</span>
          <span :class="STATE_BADGES[product.state].badge">{{ STATE_BADGES[product.state].label }}</span>
          <span v-if="product.kind" class="mb-meta">{{ KIND_LABELS[product.kind] }}</span>
          <span v-if="product.periodEnd" class="mb-meta">until {{ formatDate(product.periodEnd) }}</span>
          <span class="mb-hint lic:basis-full">{{ STATE_HINTS[product.state] }}</span>
          <a
            v-if="!managed && (product.state === 'missing' || product.state === 'lapsed')"
            class="mb-link lic:text-xs"
            :href="product.buyUrl"
            target="_blank"
            rel="noopener"
          >
            Buy a {{ product.label }} license
          </a>
        </li>
      </ul>
    </SettingsBlock>

    <SettingsBlock title="Keys" description="Each key with its lease, activation and last refresh.">
      <AsyncList
        :pending="isPending"
        :error="error"
        :retry="refetch"
        :items="keys"
        empty-icon="key"
        empty-title="No license keys"
        empty-description="Add a key here, or set MANABLOX_LICENSE_KEYS in the environment."
      >
        <ul class="mb-list mb-list-divided mb-card">
          <LicenseKeyRow v-for="entry in keys" :key="entry.id" :entry="entry" :read-only="managed" />
        </ul>
      </AsyncList>
    </SettingsBlock>

    <LicenseKeyDialog v-if="adding" @close="adding = false" />
  </SettingsPage>
</template>
