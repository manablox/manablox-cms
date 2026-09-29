import type {
  AdminMenuItem,
  AdminPlugin,
  AdminPluginContext,
  AdminSlotEntry,
  AdminSlotId,
} from '@manablox/admin-plugin';
import { registerDiffKinds } from '@manablox/admin-sdk/features/environments/model';
import { registerFeatureLabels } from '@manablox/admin-sdk/lib/features';
import { onPromoted } from '@manablox/admin-sdk/lib/invalidate';
import { declareSlot, exposePluginApi } from '@manablox/admin-sdk/lib/plugin-slots';
import { type FeatureKey, pluginFeatureKey, pluginId } from '@manablox/core';
import type { RouteRecordRaw, Router } from 'vue-router';
import type { SidePanelKey } from '~/components/layout/side-panels';
import { registerFieldComponents } from '~/lib/field-components';
import {
  type PluginOwner,
  registerAudit,
  registerPermissionIcons,
  registerRealtime,
  registerSettingsSection,
  registerSlot,
  registerTransferSection,
  registerUsageMetrics,
} from '~/lib/plugins/registry';

/** The in-space shell route plugin routes nest under. */
export const SHELL_ROUTE = 'shell';

export interface PluginHost {
  router: Router;
  registerMenu: (item: AdminMenuItem) => void;
}

/** The server's id and flag when loaded from the manifest, else derived from `name`. */
export interface PluginIdentity {
  id?: string;
  feature?: string;
}

/** Adds a plugin's routes, menu, components and registry entries, then runs its `setup`. */
export function installAdminPlugin(
  plugin: AdminPlugin,
  host: PluginHost,
  identity: PluginIdentity = {},
): void {
  const id = identity.id ?? pluginId(plugin.name);
  const feature = plugin.feature ?? identity.feature ?? pluginFeatureKey({ name: plugin.name });
  const owner: PluginOwner = { id, feature };

  for (const route of plugin.routes ?? []) {
    const record: RouteRecordRaw = {
      path: route.path,
      name: route.name,
      component: route.component,
      meta: {
        features: [route.feature ?? feature, ...(route.features ?? [])] as FeatureKey[],
        ...(route.panel ? { panel: `${id}.${route.panel}` as SidePanelKey } : {}),
        ...(route.section ? { section: route.section } : {}),
        ...(route.editor ? { editor: route.editor } : {}),
      },
    };
    if (route.inSpace !== false) host.router.addRoute(SHELL_ROUTE, record);
    else host.router.addRoute(record);
  }

  if (plugin.fields) registerFieldComponents(plugin.fields);

  // Entries answer to the plugin's flag unless they name their own.
  const registerMenu = (item: AdminMenuItem) => host.registerMenu({ feature, ...item });
  for (const item of plugin.menu ?? []) registerMenu(item);

  for (const [slot, entries] of Object.entries(plugin.slots ?? {})) {
    for (const entry of entries ?? []) {
      registerSlot(owner, slot as AdminSlotId, entry as AdminSlotEntry);
    }
  }
  for (const panel of plugin.sidePanels ?? []) registerSlot(owner, 'app.sidePanels', panel);
  for (const section of plugin.transferSections ?? []) registerTransferSection(section);
  if (plugin.features) registerFeatureLabels(plugin.features);
  if (plugin.permissionIcons) registerPermissionIcons(plugin.permissionIcons);
  if (plugin.usage) registerUsageMetrics(plugin.usage);
  if (plugin.diffKinds) registerDiffKinds(plugin.diffKinds);
  if (plugin.invalidateOnPromote) onPromoted(plugin.invalidateOnPromote);
  for (const section of plugin.settingsSections ?? []) registerSettingsSection(owner, section);
  for (const [kind, handler] of Object.entries(plugin.realtime ?? {})) {
    registerRealtime(kind, handler);
  }
  if (plugin.audit) registerAudit(plugin.audit);

  const context: AdminPluginContext = {
    id,
    defineSlot: (name) => declareSlot(id, name),
    expose: (api) => exposePluginApi(id, api),
  };
  plugin.setup?.(context);
}
