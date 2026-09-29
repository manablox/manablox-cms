import {
  CONTROL_CATALOGUE,
  HOME_NOMINATION,
  ManabloxError,
  type ManabloxPlugin,
  type PluginDataProvider,
  type PluginResourceKindName,
  pluginId,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import { type Repositories, rootRepositories, whenCommitted } from '@manablox/db';
import { API_HOST_SOURCE } from '../api-host.service.js';
import type { ResourceConfigExport } from '../code-resources/kinds.js';
import type {
  DataProviderContext,
  EnvironmentDataProvider,
  EnvironmentLiveChange,
  HostSource,
  SnapshotDataProvider,
  TransferDataProvider,
} from './provider.js';

type Config = Pick<Manablox, 'config'>;

const cache = new WeakMap<object, readonly PluginDataProvider[]>();

/** The plugins' data providers. */
export function dataProviders(manablox: Config): readonly PluginDataProvider[] {
  const plugins = manablox.config.plugins;
  const cached = cache.get(plugins);
  if (cached) return cached;
  const list = plugins.flatMap(ownProviders);
  const kinds = new Set<string>();
  for (const provider of list) {
    if (kinds.has(provider.kind))
      throw new Error(`Data provider ${provider.kind} is declared twice.`);
    kinds.add(provider.kind);
  }
  cache.set(plugins, list);
  return list;
}

function ownProviders(plugin: ManabloxPlugin): PluginDataProvider[] {
  const id = pluginId(plugin.name);
  const prefix = `${id}.`;
  for (const provider of plugin.data ?? []) {
    if (!provider.kind.startsWith(prefix) || provider.kind === prefix) {
      throw new Error(
        `Data provider ${provider.kind} of plugin ${plugin.name} must start with ${prefix}`,
      );
    }
  }
  checkCounters(plugin, id);
  return (plugin.data ?? []).map((provider) => withPlugin(provider, plugin.name));
}

/** Counters count core limits or the plugin's own, and each own limit has one. */
function checkCounters(plugin: ManabloxPlugin, id: string): void {
  const invalid = (key: string, reason: string) =>
    ManabloxError.badRequest('plugin.key.invalid', {
      plugin: plugin.name,
      kind: 'control',
      key: `limits.${key}`,
      reason,
    });
  const own = new Set(
    Object.keys(plugin.controls ?? {})
      .filter((key) => key.startsWith(`limits.plugins.${id}.`))
      .map((key) => key.slice('limits.'.length)),
  );
  const counted = new Set<string>();
  for (const provider of plugin.data ?? []) {
    for (const key of Object.keys(provider.counters ?? {})) {
      const known = key.startsWith('plugins.')
        ? own.has(key)
        : Object.hasOwn(CONTROL_CATALOGUE, `limits.${key}`);
      if (!known) throw invalid(key, 'Counted by a data provider but not a limit it may count.');
      counted.add(key);
    }
  }
  for (const key of own) {
    if (!counted.has(key)) throw invalid(key, 'No data provider of the plugin counts it.');
  }
}

/** `context` with the owning plugin's context, when the instance has that plugin loaded. */
function withPluginContext(value: unknown, name: string): unknown {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('manablox' in value) ||
    !('repos' in value)
  ) {
    return value;
  }
  const context = value as DataProviderContext;
  if (typeof context.manablox.plugin !== 'function') return context;
  return { ...context, plugin: context.manablox.plugin(name) };
}

/** The provider with `plugin` added to the context of every callback, read live. */
function withPlugin<T>(part: T, name: string): T {
  if (typeof part !== 'object' || part === null) return part;
  const list = Array.isArray(part);
  return new Proxy(part, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (list && (typeof key !== 'string' || !/^\d+$/.test(key))) return value;
      if (typeof value === 'function') {
        return (first: unknown, ...rest: unknown[]) =>
          value.call(target, withPluginContext(first, name), ...rest);
      }
      return key === 'section' ? value : withPlugin(value, name);
    },
  });
}

/** A provider's environment part, with its key. */
export interface EnvironmentProvider {
  key: string;
  handler: EnvironmentDataProvider;
}

/** Providers with an environment part, each after the groups its `after` names. */
export function environmentProviders(manablox: Config): EnvironmentProvider[] {
  const list = dataProviders(manablox).flatMap((provider) =>
    provider.environments
      ? [{ key: provider.environments.key ?? provider.kind, handler: provider.environments }]
      : [],
  );
  return dependencyOrder(
    list,
    (entry) => entry.key,
    (entry) => entry.handler.after,
    'promote group',
  );
}

/**
 * Tells the providers that a space's environments changed, once `repos`' transaction commits
 * (now outside one). A failing listener is logged.
 */
export async function notifyLiveChange(
  manablox: Manablox,
  repos: Repositories,
  spaceId: string,
  reason: EnvironmentLiveChange,
): Promise<void> {
  const listeners = environmentProviders(manablox).filter(({ handler }) => handler.onLiveChange);
  if (listeners.length === 0) return;
  await whenCommitted(repos, async () => {
    for (const { key, handler } of listeners) {
      try {
        await handler.onLiveChange?.({ manablox, repos: rootRepositories(repos), spaceId, reason });
      } catch (error) {
        manablox.logger.error({ err: error, provider: key, spaceId }, 'onLiveChange failed');
      }
    }
  });
}

/** Every environment nomination, the home page first. */
export function environmentNominations(manablox: Config) {
  return [
    HOME_NOMINATION,
    ...dataProviders(manablox).flatMap((provider) => provider.environments?.nominations ?? []),
  ];
}

/** A provider's transfer part, with its kind. */
export interface TransferProvider {
  kind: string;
  transfer: TransferDataProvider;
}

/** Providers with a transfer section, each after the ones it depends on. */
export function transferProviders(manablox: Config): TransferProvider[] {
  const list = dataProviders(manablox).flatMap(({ kind, transfer }) =>
    transfer ? [{ kind, transfer }] : [],
  );
  return dependencyOrder(
    list,
    (entry) => entry.kind,
    (entry) => entry.transfer.section.dependsOn,
    'transfer section',
  );
}

/**
 * `list` with each entry after the entries its `after` names, else in list order. Names of
 * entries that are not there are ignored; a cycle throws.
 */
function dependencyOrder<T>(
  list: T[],
  key: (entry: T) => string,
  after: (entry: T) => readonly string[] | undefined,
  what: string,
): T[] {
  const byKey = new Map(list.map((entry) => [key(entry), entry]));
  const out: T[] = [];
  const placed = new Set<T>();
  const place = (entry: T, path: T[]) => {
    if (placed.has(entry)) return;
    if (path.includes(entry)) {
      const cycle = [...path.slice(path.indexOf(entry)), entry].map(key).join(' -> ');
      throw new Error(`The ${what}s depend on each other in a cycle: ${cycle}`);
    }
    for (const name of after(entry) ?? []) {
      const dependency = byKey.get(name);
      if (dependency) place(dependency, [...path, entry]);
    }
    placed.add(entry);
    out.push(entry);
  };
  for (const entry of list) place(entry, []);
  return out;
}

/** A provider's snapshot part that keeps state, with its kind. */
export interface SnapshotProvider {
  kind: string;
  snapshot: SnapshotDataProvider & Required<Pick<SnapshotDataProvider, 'capture' | 'restore'>>;
}

export function snapshotProviders(manablox: Config): SnapshotProvider[] {
  return dataProviders(manablox).flatMap(({ kind, snapshot }) =>
    snapshot?.capture && snapshot.restore
      ? [{ kind, snapshot: snapshot as SnapshotProvider['snapshot'] }]
      : [],
  );
}

/** A provider's hook for credential secrets carried over by a restore, with its kind. */
export interface CredentialsRestoredHook {
  kind: string;
  hook: NonNullable<SnapshotDataProvider['afterCredentialsRestored']>;
}

export function credentialsRestoredHooks(manablox: Config): CredentialsRestoredHook[] {
  return dataProviders(manablox).flatMap(({ kind, snapshot }) => {
    const hook = snapshot?.afterCredentialsRestored;
    return hook ? [{ kind, hook: hook.bind(snapshot) }] : [];
  });
}

/** Every table of host names: the providers', then API hosts. */
export function hostSources(manablox: Config): HostSource[] {
  return [
    ...dataProviders(manablox).flatMap((provider) => (provider.hosts ? [provider.hosts] : [])),
    API_HOST_SOURCE,
  ];
}

/** A resource kind's config export, with the kind. */
export interface ConfigExportProvider {
  kind: PluginResourceKindName;
  configExport: ResourceConfigExport;
}

/** The plugin resource kinds the config export writes, in boot order. */
export function configExportProviders(manablox: Config): ConfigExportProvider[] {
  return manablox.config.plugins.flatMap((plugin) =>
    Object.entries(plugin.resourceKinds ?? {}).flatMap(([kind, spec]) =>
      spec.configExport
        ? [{ kind: kind as PluginResourceKindName, configExport: spec.configExport }]
        : [],
    ),
  );
}

/** Tags the providers purge with a space's caches. */
export function providerCacheTags(manablox: Config, spaceId: string): string[] {
  return dataProviders(manablox).flatMap((provider) => provider.cacheTags?.(spaceId) ?? []);
}
