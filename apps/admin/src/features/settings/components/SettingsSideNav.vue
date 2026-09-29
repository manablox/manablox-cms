<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import SidePanel from '@manablox/admin-sdk/components/layout/SidePanel.vue';
import NavList from '@manablox/admin-sdk/components/ui/NavList.vue';
import NavListItem from '@manablox/admin-sdk/components/ui/NavListItem.vue';
import { usePanel } from '@manablox/admin-sdk/composables/usePanel';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed } from 'vue';
import { settingsTo } from '../sections';
import { useSettingsSections } from '../useSettingsSections';

/** Settings sections beside the settings page: the current space's, then the instance's. */
const spaces = useSpaceStore();
const panel = usePanel('settings');
const { sections, active } = useSettingsSections();

const spaceSections = computed(() => sections.value.filter((entry) => entry.scope === 'space'));
const instanceSections = computed(() =>
  sections.value.filter((entry) => entry.scope === 'instance'),
);
</script>

<template>
  <SidePanel label="Settings" to="/settings" resize="settings" @hide="panel.toggle()">
    <div class="space-y-5">
      <section v-if="spaceSections.length" aria-labelledby="settings-space-heading">
        <div class="px-2 pb-2">
          <h2 id="settings-space-heading" class="text-2xs font-semibold tracking-[0.12em] text-surface-500 uppercase">This space</h2>
          <p class="mt-0.5 truncate text-sm font-semibold" :title="spaces.current?.machineName">
            {{ spaces.current?.name }}
          </p>
        </div>
        <NavList aria-label="Space settings">
          <NavListItem
            v-for="entry in spaceSections"
            :key="entry.id"
            :to="settingsTo(entry.id)"
            :icon="entry.icon"
            :active="active.id === entry.id"
            compact
          >
            {{ entry.label }}
            <template v-if="entry.locked" #trailing>
              <Icon name="lock" class="mb-icon-sm shrink-0 text-surface-400" />
              <span class="sr-only">(locked)</span>
            </template>
          </NavListItem>
        </NavList>
      </section>

      <section aria-labelledby="settings-instance-heading">
        <div class="px-2 pb-2">
          <h2 id="settings-instance-heading" class="text-2xs font-semibold tracking-[0.12em] text-surface-500 uppercase">Instance</h2>
          <p class="mt-0.5 mb-meta">Shared by every space</p>
        </div>
        <NavList aria-label="Instance settings">
          <NavListItem
            v-for="entry in instanceSections"
            :key="entry.id"
            :to="settingsTo(entry.id)"
            :icon="entry.icon"
            :active="active.id === entry.id"
            compact
          >
            {{ entry.label }}
            <template v-if="entry.locked" #trailing>
              <Icon name="lock" class="mb-icon-sm shrink-0 text-surface-400" />
              <span class="sr-only">(locked)</span>
            </template>
          </NavListItem>
        </NavList>
      </section>
    </div>
  </SidePanel>
</template>
