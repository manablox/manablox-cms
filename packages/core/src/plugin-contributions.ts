/** Extension points plugins declare and the contributions other plugins make to them. */

import { ManabloxError } from './errors.js';
import { type ManabloxPlugin, pluginId } from './plugin.js';

/** A point other plugins fill, declared in `extensionPoints`. */
export interface ExtensionPointSpec<T = unknown> {
  description?: string;
  /** Checks one contributed entry when the config resolves; throw to refuse the start. */
  check?(entry: T, contributor: string): void;
}

/** Declares an extension point whose entries are `T`. */
export function extensionPoint<T>(spec: ExtensionPointSpec<T> = {}): ExtensionPointSpec<T> {
  return spec;
}

/**
 * Entry types of extension points, by the declaring plugin's id, then point. The declaring
 * plugin augments it in its package, so contributions to it are checked:
 *
 * ```ts
 * declare module '@manablox/core' {
 *   interface PluginContributions { 'hello-extra': { greeters: Greeter } }
 * }
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by plugin packages
export interface PluginContributions {}

/** The entry type of a point; `unknown` for a point nobody declared a type for. */
export type ContributionOf<
  Target extends string,
  Point extends string,
> = Target extends keyof PluginContributions
  ? Point extends keyof PluginContributions[Target]
    ? PluginContributions[Target][Point]
    : unknown
  : unknown;

/** A plugin's `contributions`: entries by target plugin id, then point. */
export type PluginContributionMap = {
  [Target in keyof PluginContributions]?: {
    [Point in keyof PluginContributions[Target]]?: readonly PluginContributions[Target][Point][];
  };
} & {
  [target: string]: { [point: string]: readonly unknown[] | undefined } | undefined;
};

/** One contributed entry with the id of the plugin that contributed it. */
export interface Contribution<T = unknown> {
  /** The contributing plugin's id; its flag gates the entry. */
  plugin: string;
  entry: T;
}

/**
 * Refuses contributions to a point the configured target does not declare, and entries its
 * `check` refuses. Contributions to targets that are not configured are skipped later.
 */
export function checkContributions(plugins: readonly ManabloxPlugin[]): void {
  const byId = new Map(plugins.map((plugin) => [pluginId(plugin.name), plugin]));
  for (const plugin of plugins) {
    for (const [target, points] of Object.entries(plugin.contributions ?? {})) {
      const owner = byId.get(target);
      if (!owner) continue;
      for (const [point, entries] of Object.entries(points ?? {})) {
        const spec = owner.extensionPoints?.[point];
        if (!spec) {
          throw ManabloxError.badRequest('plugin.contribution.unknown', {
            plugin: plugin.name,
            target,
            point,
          });
        }
        for (const entry of entries ?? []) spec.check?.(entry, plugin.name);
      }
    }
  }
}

/** Every configured plugin's contributions by target plugin name, then point, in boot order. */
export function collectContributions(
  plugins: readonly ManabloxPlugin[],
  skipped: (plugin: string, target: string) => void,
): Map<string, Map<string, Contribution[]>> {
  const byId = new Map(plugins.map((plugin) => [pluginId(plugin.name), plugin]));
  const out = new Map<string, Map<string, Contribution[]>>();
  for (const plugin of plugins) {
    const id = pluginId(plugin.name);
    for (const [target, points] of Object.entries(plugin.contributions ?? {})) {
      const owner = byId.get(target);
      if (!owner) {
        skipped(plugin.name, target);
        continue;
      }
      const byPoint = out.get(owner.name) ?? new Map<string, Contribution[]>();
      out.set(owner.name, byPoint);
      for (const [point, entries] of Object.entries(points ?? {})) {
        const list = byPoint.get(point) ?? [];
        byPoint.set(point, list);
        for (const entry of entries ?? []) list.push({ plugin: id, entry });
      }
    }
  }
  return out;
}
