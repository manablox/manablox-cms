import type { AdminPlugin } from '@manablox/admin-plugin';
import { SDK_API_LEVEL } from '@manablox/admin-sdk/lib/api-level';

/** A plugin bundle as `/admin/plugins.json` lists it. */
export interface RuntimePluginEntry {
  id: string;
  name: string;
  version: string | null;
  /** URL of the ES module entry. */
  entry: string;
  css: string[];
  /** The plugin's flag. */
  feature: string;
  /** The lowest admin SDK API level the bundle needs. */
  sdkLevel: number;
}

interface RuntimePluginManifest {
  plugins: RuntimePluginEntry[];
}

export interface LoadedPlugin {
  entry: RuntimePluginEntry;
  plugin: AdminPlugin;
}

export interface PluginFailure {
  id: string;
  message: string;
}

export interface LoaderDeps {
  /** Null when the server lists no plugins. */
  fetchManifest: () => Promise<RuntimePluginManifest | null>;
  importEntry: (url: string) => Promise<{ default?: unknown }>;
  /** Whether the import map hands plugins the admin's own module instances. */
  sharedIntact: () => Promise<boolean>;
  /** Adds a stylesheet; the returned function removes it again. */
  addStylesheet: (url: string) => () => void;
  sdkLevels: SdkLevels;
}

const MANIFEST_URL = '/admin/plugins.json';

/** The admin SDK API levels this admin serves plugins. */
export interface SdkLevels {
  min: number;
  current: number;
}

/** Levels below `min` lost surface this admin no longer has. */
export const SUPPORTED_SDK_LEVELS: SdkLevels = { min: 1, current: SDK_API_LEVEL };

/** Whether a bundle needing `level` runs on an admin serving `levels`. */
export function compatibleSdk(level: unknown, levels: SdkLevels): boolean {
  return (
    Number.isInteger(level) &&
    (level as number) >= levels.min &&
    (level as number) <= levels.current
  );
}

function isAdminPlugin(value: unknown): value is AdminPlugin {
  return (
    typeof value === 'object' && value !== null && typeof (value as AdminPlugin).name === 'string'
  );
}

/**
 * Imports every listed bundle; one that fails or does not fit is skipped and reported. The
 * shared-module check runs alongside the imports, and nothing is handed out unless it passes.
 * `onLoaded` gets each plugin as soon as it and every one listed before it have settled, so
 * plugins arrive in the manifest's order, the server's boot order, which installs them.
 */
export async function loadRuntimePlugins(
  deps: LoaderDeps,
  onLoaded: (loaded: LoadedPlugin) => void = () => {},
): Promise<{ plugins: LoadedPlugin[]; failures: PluginFailure[] }> {
  let manifest: RuntimePluginManifest | null;
  try {
    manifest = await deps.fetchManifest();
  } catch (error) {
    return { plugins: [], failures: [{ id: 'manifest', message: describe(error) }] };
  }

  const entries = manifest?.plugins ?? [];
  if (entries.length === 0) return { plugins: [], failures: [] };

  const intact = deps.sharedIntact();
  const removers: Array<() => void> = [];
  const pending = entries.map(async (entry): Promise<LoadedPlugin | PluginFailure> => {
    const { min, current } = deps.sdkLevels;
    if (!compatibleSdk(entry.sdkLevel, deps.sdkLevels)) {
      const fix = (entry.sdkLevel as number) > current ? 'update Manablox' : 'update the plugin';
      const supported = min === current ? `level ${min}` : `${min} to ${current}`;
      return {
        id: entry.id,
        message: `needs admin SDK level ${entry.sdkLevel}, this admin supports ${supported}; ${fix}`,
      };
    }
    const sheets = entry.css.map((url) => deps.addStylesheet(url));
    try {
      const module = await deps.importEntry(entry.entry);
      if (!isAdminPlugin(module.default)) throw new Error('its entry exports no admin plugin');
      removers.push(...sheets);
      return { entry, plugin: module.default };
    } catch (error) {
      for (const remove of sheets) remove();
      return { id: entry.id, message: describe(error) };
    }
  });

  if (!(await intact)) {
    // The imports ran alongside the check; what they loaded is dropped unused.
    await Promise.allSettled(pending);
    for (const remove of removers) remove();
    const message = 'the shared modules are not single instances, so no plugin was loaded';
    return { plugins: [], failures: [{ id: 'admin', message }] };
  }

  const plugins: LoadedPlugin[] = [];
  const failures: PluginFailure[] = [];
  for (const next of pending) {
    const result = await next;
    if (!('plugin' in result)) {
      failures.push(result);
      continue;
    }
    plugins.push(result);
    onLoaded(result);
  }
  return { plugins, failures };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The id of the plugin list the server inlines into `index.html`. */
const INLINE_MANIFEST_ID = 'manablox-plugins';

/** The browser implementations; `own` are the admin's `vue` and SDK modules. */
export const browserLoaderDeps = (own: { vue: object; sdk: object }): LoaderDeps => ({
  async sharedIntact() {
    const load = (specifier: string) => import(/* @vite-ignore */ specifier);
    try {
      const [vue, sdk] = await Promise.all([load('vue'), load('@manablox/admin-sdk')]);
      return (
        vue.ref === (own.vue as { ref: unknown }).ref &&
        sdk.toast === (own.sdk as { toast: unknown }).toast
      );
    } catch {
      return false;
    }
  },
  async fetchManifest() {
    // Served by the API, `index.html` carries the list; an admin served elsewhere fetches it.
    const inline = document.getElementById(INLINE_MANIFEST_ID)?.textContent;
    if (inline) return JSON.parse(inline) as RuntimePluginManifest;
    const response = await fetch(MANIFEST_URL, { headers: { accept: 'application/json' } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${MANIFEST_URL} answered ${response.status}`);
    if (!response.headers.get('content-type')?.includes('application/json')) return null;
    return (await response.json()) as RuntimePluginManifest;
  },
  importEntry: (url) => import(/* @vite-ignore */ url),
  addStylesheet(url) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    document.head.append(link);
    return () => link.remove();
  },
  sdkLevels: SUPPORTED_SDK_LEVELS,
});
