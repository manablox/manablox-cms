<script setup lang="ts">
import { EntityPanel } from '@manablox/admin-sdk';
import { useRoute } from 'vue-router';
import { DESIGN_NAV } from '../model/status';

/** The Design section's pages, mounted by `Shell` on `/design` routes. */
const route = useRoute();
const items = DESIGN_NAV.map((entry) => ({ id: entry.to, ...entry }));

const active = (item: (typeof items)[number]) =>
  item.to === '/design'
    ? route.path === '/design'
    : route.path === item.to || route.path.startsWith(`${item.to}/`);
</script>

<template>
  <EntityPanel
    label="Design"
    to="/design"
    panel-key="website.design"
    icon="palette"
    :items="items"
    :pending="false"
    empty-title="Nothing here"
    empty-description=""
    :item-to="(item) => item.to"
    :item-icon="(item) => item.icon"
    :active="active"
  >
    <template #item="{ item }">
      <span class="ws:block ws:min-w-0">
        <span class="ws:block ws:truncate ws:text-sm">{{ item.label }}</span>
        <span class="ws:block ws:truncate ws:text-2xs ws:text-surface-500">{{ item.hint }}</span>
      </span>
    </template>
  </EntityPanel>
</template>
