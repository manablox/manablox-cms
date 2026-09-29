import { adminPlugins } from 'virtual:manablox/admin-plugins';
import type { AdminPlugin } from '@manablox/admin-plugin';
import { api, errorKey } from '@manablox/admin-sdk/lib/api';
import { registerPluginFeatures } from '@manablox/admin-sdk/lib/features';
import { registerPluginMessages } from '@manablox/admin-sdk/lib/messages';
import { toast } from '@manablox/admin-sdk/lib/toast';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { ref, watch } from 'vue';
import type { PluginIdentity } from './install';
import { browserLoaderDeps, loadRuntimePlugins, type PluginFailure } from './loader';

/** A plugin to install, with the server's identity when it came from the manifest. */
export interface BootPlugin {
  plugin: AdminPlugin;
  identity: PluginIdentity;
}

/**
 * The dev server's source plugins, or in a build the bundles the server lists, imported at
 * runtime. Each goes to `install` as it arrives, in the list's order; the promise settles
 * once all of them have, with what failed to load.
 */
export async function bootPlugins(
  install: (plugin: BootPlugin) => void,
): Promise<{ failures: PluginFailure[] }> {
  if (import.meta.env.DEV) {
    for (const plugin of adminPlugins) install({ plugin, identity: {} });
    return { failures: [] };
  }
  const { failures } = await loadRuntimePlugins(
    browserLoaderDeps({ vue: { ref }, sdk: { toast } }),
    ({ entry, plugin }) => install({ plugin, identity: { id: entry.id, feature: entry.feature } }),
  );
  for (const failure of failures) console.error(`admin plugin ${failure.id}: ${failure.message}`);
  return { failures };
}

/** Shows superadmins what failed to load, once they are signed in. */
export function reportPluginFailures(failures: readonly PluginFailure[]): void {
  if (failures.length === 0) return;
  const session = useSessionStore();
  const stop = watch(
    () => session.isSuperadmin,
    (superadmin) => {
      if (!superadmin) return;
      for (const failure of failures)
        toast.error(`Plugin ${failure.id} was not loaded: ${failure.message}`);
      queueMicrotask(() => stop());
    },
    { immediate: true },
  );
}

/** Loads the server's plugin catalogue (labels, error sentences) once a user is signed in. */
export function loadPluginCatalogue(): void {
  const session = useSessionStore();
  let loaded = false;
  watch(
    () => session.isAuthenticated,
    async (signedIn) => {
      if (!signedIn || loaded) return;
      loaded = true;
      try {
        const plugins = await api.instance.plugins();
        registerPluginFeatures(plugins);
        registerPluginMessages(plugins);
      } catch (error) {
        loaded = false;
        // A suspended instance refuses it; the suspended page covers that.
        if (errorKey(error) !== 'control.suspended') console.error('plugin catalogue', error);
      }
    },
    { immediate: true },
  );
}
