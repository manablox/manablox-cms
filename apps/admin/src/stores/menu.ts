import type { AdminMenuGroup, AdminMenuItem } from '@manablox/admin-plugin';
import type { FeatureState } from '@manablox/admin-sdk/lib/features';
import type { FeatureKey } from '@manablox/core';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

/** Sidebar categories, top to bottom. */
const MENU_GROUPS: ReadonlyArray<{ id: AdminMenuGroup; label: string }> = [
  { id: 'content', label: 'Content' },
  { id: 'automation', label: 'Automation' },
  { id: 'structure', label: 'Structure' },
  { id: 'system', label: 'System' },
];

/** Above the categories. */
const HOME: AdminMenuItem = { label: 'Dashboard', icon: 'home', to: '/', shortcut: 'd' };

// `shortcut` is the second key of the `g` sequence.
const BUILT_IN: AdminMenuItem[] = [
  { label: 'Content', icon: 'tree', to: '/content', group: 'content', order: 100, shortcut: 'c' },
  {
    label: 'Templates',
    icon: 'template',
    to: '/templates',
    group: 'content',
    order: 200,
    permission: 'content:read',
    shortcut: 't',
  },
  {
    label: 'Databags',
    icon: 'database',
    to: '/databags',
    group: 'content',
    order: 300,
    permission: 'content:read',
    shortcut: 'b',
    feature: 'databags',
  },
  { label: 'Assets', icon: 'image', to: '/assets', group: 'content', order: 400, shortcut: 'a' },
  {
    label: 'Menus',
    icon: 'menu',
    to: '/menus',
    group: 'content',
    order: 500,
    permission: 'menu:read',
    shortcut: 'm',
    feature: 'menus',
  },
  {
    label: 'Content types',
    icon: 'blocks',
    to: '/types',
    group: 'structure',
    order: 100,
    permission: 'contentType:write',
    shortcut: 'y',
  },
  {
    label: 'Databag types',
    icon: 'table',
    to: '/databag-types',
    group: 'structure',
    order: 200,
    permission: 'contentType:write',
    shortcut: 'x',
    feature: 'databags',
  },
  {
    label: 'Redirects',
    icon: 'branch',
    to: '/redirects',
    group: 'structure',
    order: 250,
    permission: 'redirect:read',
    shortcut: 'r',
  },
  {
    label: 'Activity',
    icon: 'activity',
    to: '/activity',
    group: 'system',
    order: 100,
    permission: 'audit:read',
    shortcut: 'l',
  },
  {
    label: 'Settings',
    icon: 'settings',
    to: '/settings',
    group: 'system',
    order: 200,
    permission: 'space:write',
    shortcut: 's',
  },
];

/** A sidebar entry the viewer may see; `locked` shows a lock and opens the locked panel. */
export interface MenuEntry extends AdminMenuItem {
  locked: boolean;
}

/** Drops entries without the permission or with a hidden feature; marks locked ones. */
export function menuEntries(
  items: readonly AdminMenuItem[],
  context: {
    can: (permission: string) => boolean;
    feature: (key: FeatureKey) => FeatureState;
  },
): MenuEntry[] {
  return items.flatMap((item) => {
    if (item.permission && !context.can(item.permission)) return [];
    const state = item.feature ? context.feature(item.feature as FeatureKey) : null;
    if (state?.hidden) return [];
    return [{ ...item, locked: Boolean(state?.locked) }];
  });
}

export const useNavStore = defineStore('menu', () => {
  const extra = ref<AdminMenuItem[]>([]);

  function register(item: AdminMenuItem): void {
    extra.value.push(item);
  }

  /** Every entry, built-ins first so their shortcuts win. */
  const items = computed(() => [HOME, ...BUILT_IN, ...extra.value]);

  /** The categories with their entries, including empty ones. */
  const groups = computed(() => {
    const all = [...BUILT_IN, ...extra.value];
    return MENU_GROUPS.map((group) => ({
      ...group,
      items: all
        .filter((item) => (item.group ?? 'content') === group.id)
        .sort((a, b) => (a.order ?? 500) - (b.order ?? 500)),
    }));
  });

  return { home: HOME, items, groups, register };
});
