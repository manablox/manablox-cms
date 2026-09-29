<script setup lang="ts">
import IconButton from '@manablox/admin-sdk/components/ui/IconButton.vue';
import Select from '@manablox/admin-sdk/components/ui/Select.vue';
import { usePanel } from '@manablox/admin-sdk/composables/usePanel';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { useUiStore } from '@manablox/admin-sdk/stores/ui';
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import Logo from '~/components/Logo.vue';
import SidebarLink from '~/components/SidebarLink.vue';
import ThemeToggle from '~/components/ThemeToggle.vue';
import EnvironmentSwitcher from '~/features/environments/components/EnvironmentSwitcher.vue';
import { isSectionActive } from '~/lib/sections';
import { menuEntries, useNavStore } from '~/stores/menu';

/** App sidebar: logo, space picker, sections and the current user. */
const menu = useNavStore();
const panel = usePanel('sidebar');
const ui = useUiStore();
// The mobile drawer never collapses.
const collapsed = computed(() => panel.collapsed.value && ui.isWide);
const session = useSessionStore();
const spaces = useSpaceStore();
const route = useRoute();

// Hide entries without permission or with a hidden feature, and categories left empty.
const groups = computed(() =>
  menu.groups
    .map((group) => ({
      ...group,
      items: menuEntries(group.items, {
        can: (permission) => session.can(permission, spaces.currentId),
        feature: (key) => session.feature(key, spaces.currentId),
      }),
    }))
    .filter((group) => group.items.length),
);

const isActive = (to: string) => isSectionActive(route, to);

const initials = computed(() => {
  const source = session.me?.name || session.me?.email || '?';
  return source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
});

async function signOut() {
  await session.signOut();
  // Full reload discards every store and cached query.
  window.location.assign('/login');
}
</script>

<template>
  <aside
    class="mb-z-overlay fixed inset-y-0 left-0 flex shrink-0 flex-col overflow-hidden border-r border-surface-200 bg-surface-0 whitespace-nowrap text-surface-900 transition-[width,transform] duration-[var(--mb-dur-slow)] ease-[var(--mb-ease-out)] lg:static lg:translate-x-0 dark:border-surface-800 dark:bg-surface-950 dark:text-surface-100"
    :class="[collapsed ? 'w-[3.25rem]' : 'w-[13.5rem]', ui.navOpen ? 'translate-x-0 shadow-modal' : '-translate-x-full']"
    :aria-hidden="!ui.isWide && !ui.navOpen ? 'true' : undefined"
  >
    <div
      class="flex shrink-0 items-center"
      :class="collapsed ? 'h-20 flex-col justify-center gap-2' : 'h-14 gap-2 pr-2 pl-4'"
    >
      <RouterLink to="/" class="flex min-w-0 flex-1 items-center" :class="collapsed ? 'flex-none' : ''" aria-label="Manablox - dashboard">
        <Logo :size="26" :wordmark="!collapsed" />
      </RouterLink>
      <IconButton icon="x" label="Close menu" class="rounded-control lg:hidden" @click="ui.navOpen = false" />
      <IconButton
        :icon="collapsed ? 'panel-open' : 'panel-close'"
        :label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        class="hidden rounded-control lg:inline-flex"
        :aria-expanded="!collapsed"
        @click="panel.toggle()"
      />
    </div>

    <div v-if="!collapsed" class="px-3 pb-2">
      <label class="sr-only" for="space-select">Space</label>
      <Select
        v-if="spaces.spaces.length"
        id="space-select"
        v-model="spaces.currentId"
        :options="spaces.spaces.map((space) => ({ value: space.id, label: space.name, hint: space.machineName }))"
      />
      <p v-else class="mb-control border-transparent bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400">No space yet</p>
      <EnvironmentSwitcher v-if="spaces.currentId" />
    </div>

    <nav class="flex-1 overflow-y-auto px-2 pt-2 pb-2" aria-label="Sections">
      <ul class="mb-list">
        <li>
          <SidebarLink :item="menu.home" :collapsed="collapsed" :active="isActive(menu.home.to)" />
        </li>
      </ul>
      <section v-for="group in groups" :key="group.id" :aria-labelledby="`nav-group-${group.id}`" class="mt-3">
        <h2
          :id="`nav-group-${group.id}`"
          :class="collapsed ? 'sr-only' : 'px-2.5 pb-1 text-2xs font-semibold tracking-[0.12em] text-surface-500 uppercase'"
        >
          {{ group.label }}
        </h2>
        <div v-if="collapsed" class="mx-2 mb-2 border-t border-surface-200 dark:border-surface-800" aria-hidden="true" />
        <ul class="mb-list">
          <li v-for="item in group.items" :key="item.to">
            <SidebarLink :item="item" :collapsed="collapsed" :active="isActive(item.to)" :locked="item.locked" />
          </li>
        </ul>
      </section>
    </nav>

    <div class="border-t border-surface-200 p-2 dark:border-surface-800">
      <div class="flex items-center gap-2" :class="collapsed ? 'flex-col' : 'px-1 py-1'">
        <RouterLink
          to="/profile"
          class="flex min-w-0 flex-1 items-center gap-2 rounded-control transition hover:bg-surface-100 dark:hover:bg-surface-800"
          :class="collapsed ? 'flex-none' : '-mx-1 px-1'"
          :title="collapsed ? `${session.me?.name || session.me?.email} - ${session.me?.role}` : 'Your profile'"
          aria-label="Your profile"
          :aria-current="isActive('/profile') ? 'page' : undefined"
        >
          <span
            class="flex shrink-0 items-center justify-center rounded-pill bg-iris-100 text-2xs font-bold text-iris-700 dark:bg-iris-500/25 dark:text-iris-100"
            style="height: var(--mb-control-h); width: var(--mb-control-h)"
          >
            {{ initials }}
          </span>
          <span v-if="!collapsed" class="min-w-0 flex-1">
            <span class="block truncate text-sm font-semibold">{{ session.me?.name || session.me?.email }}</span>
            <span class="block truncate text-2xs text-surface-500 dark:text-surface-400">{{ session.me?.role }}</span>
          </span>
        </RouterLink>
        <ThemeToggle />
        <IconButton icon="logout" label="Sign out" class="rounded-control" @click="signOut" />
      </div>
    </div>
  </aside>
</template>
