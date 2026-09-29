import Skeleton from '@manablox/admin-sdk/components/ui/Skeleton.vue';
import { type AsyncComponentLoader, type Component, defineAsyncComponent, h } from 'vue';
import type { RouteLocationNormalizedLoaded } from 'vue-router';
import { pluginSidePanel } from '~/lib/plugins/registry';

/** A built-in side list beside a section's pages. */
export type CoreSidePanelKey =
  | 'tree'
  | 'templates'
  | 'types'
  | 'databags'
  | 'databagTypes'
  | 'menus'
  | 'settings';

/** A side list: built in, or a plugin's as `<plugin id>.<key>`. */
export type SidePanelKey = CoreSidePanelKey | `${string}.${string}`;

/** A side list shown beside a section's pages: wide-screen column, drawer and top bar toggle. */
export interface SidePanelEntry {
  key: SidePanelKey;
  label: string;
  icon: string;
  component: Component;
  /** Props for `component`, when one component serves several lists. */
  props?: Record<string, unknown>;
}

// Shown only past the delay, so fast loads never flash.
const PanelLoading = () =>
  h('aside', { class: 'h-full w-full p-3', 'aria-busy': 'true' }, h(Skeleton, { count: 8 }));
const lazy = (loader: AsyncComponentLoader) =>
  defineAsyncComponent({ loader, loadingComponent: PanelLoading, delay: 150 });
const DatabagSideList = lazy(() => import('~/features/databags/components/DatabagSideList.vue'));

/** Every side panel; a route names its own with `meta.panel`. */
export const SIDE_PANELS: Record<CoreSidePanelKey, SidePanelEntry> = {
  tree: {
    key: 'tree',
    label: 'Tree',
    icon: 'tree',
    component: lazy(() => import('~/features/content/components/ContentTreeSideList.vue')),
  },
  templates: {
    key: 'templates',
    label: 'Templates',
    icon: 'template',
    component: lazy(() => import('~/features/content/components/TemplateSideList.vue')),
  },
  types: {
    key: 'types',
    label: 'Types',
    icon: 'blocks',
    component: lazy(() => import('~/features/content-types/components/ContentTypeSideList.vue')),
  },
  databags: {
    key: 'databags',
    label: 'Databags',
    icon: 'database',
    component: DatabagSideList,
    props: { mode: 'entries' },
  },
  databagTypes: {
    key: 'databagTypes',
    label: 'Databag types',
    icon: 'table',
    component: DatabagSideList,
    props: { mode: 'types' },
  },
  menus: {
    key: 'menus',
    label: 'Menus',
    icon: 'menu',
    component: lazy(() => import('~/features/menus/components/MenuSideList.vue')),
  },
  settings: {
    key: 'settings',
    label: 'Settings',
    icon: 'settings',
    component: lazy(() => import('~/features/settings/components/SettingsSideNav.vue')),
  },
};

/** The route's side panel, if it has one. */
export function sidePanelFor(route: RouteLocationNormalizedLoaded): SidePanelEntry | null {
  const key = route.meta.panel;
  if (!key) return null;
  if (key in SIDE_PANELS) return SIDE_PANELS[key as CoreSidePanelKey];
  const plugin = pluginSidePanel(key);
  return plugin
    ? {
        key,
        label: plugin.label ?? key,
        icon: plugin.icon ?? 'blocks',
        component: plugin.component,
      }
    : null;
}
