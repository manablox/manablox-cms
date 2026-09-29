/** Plugin and code-resource merging for `resolveConfig`; not part of the public entry. */

import type { PluginResourceEntry, SpaceTarget } from './code-resource.js';
import type { ContentTypeInput, FieldInput } from './content-type.js';
import { ManabloxError } from './errors.js';
import { type ContentTypeExtension, type ManabloxPlugin, pluginId } from './plugin.js';
import type { AnyFieldType } from './types.js';

/** Dedupes plugins by name, keeping the first. */
export function flattenPlugins(plugins: ManabloxPlugin[]): ManabloxPlugin[] {
  const out: ManabloxPlugin[] = [];
  const seen = new Set<string>();

  const walk = (list: ManabloxPlugin[]) => {
    for (const plugin of list) {
      if (seen.has(plugin.name)) continue;
      seen.add(plugin.name);
      out.push(plugin);
    }
  };

  walk(plugins);
  return out;
}

/** A declaration once it is resolved: it knows which plugin, or config, declared it. */
interface Declared {
  slug: string;
  spaces: SpaceTarget;
  sourceRef?: string;
}

/** Config first, then plugins, each stamped with its source. Duplicate slugs fail at boot. */
export function collect<T extends Declared>(
  kind: string,
  own: T[] | undefined,
  plugins: ManabloxPlugin[],
  of: (plugin: ManabloxPlugin) => T[] | undefined,
): T[] {
  const bySlug = new Map<string, T>();
  const add = (entry: T, sourceRef: string) => {
    const existing = bySlug.get(entry.slug);
    if (existing) {
      throw ManabloxError.conflict('codeResource.duplicate', {
        kind,
        slug: entry.slug,
        a: existing.sourceRef,
        b: sourceRef,
      });
    }
    bySlug.set(entry.slug, { ...entry, sourceRef });
  };

  for (const entry of own ?? []) add(entry, 'config');
  for (const plugin of plugins) {
    for (const entry of of(plugin) ?? []) add(entry, plugin.name);
  }
  return [...bySlug.values()];
}

/**
 * Entries of plugin resource kinds, config first. A kind must be owned by a loaded plugin, as
 * `<its id>.<name>`; duplicate slugs of one kind fail at boot.
 */
export function collectPluginResources(
  own: Record<string, PluginResourceEntry[]> | undefined,
  plugins: ManabloxPlugin[],
): Record<string, PluginResourceEntry[]> {
  const owners = new Map<string, string>();
  for (const plugin of plugins) {
    const prefix = `${pluginId(plugin.name)}.`;
    for (const kind of Object.keys(plugin.resourceKinds ?? {})) {
      if (!kind.startsWith(prefix) || kind === prefix) {
        throw ManabloxError.badRequest('plugin.key.invalid', {
          plugin: plugin.name,
          kind: 'resource',
          key: kind,
          reason: `Resource kinds start with ${prefix}`,
        });
      }
      owners.set(kind, plugin.name);
    }
  }
  const kinds = new Set([
    ...Object.keys(own ?? {}),
    ...plugins.flatMap((plugin) => Object.keys(plugin.resources ?? {})),
  ]);
  const out: Record<string, PluginResourceEntry[]> = {};
  for (const kind of kinds) {
    if (!owners.has(kind)) {
      throw ManabloxError.badRequest('plugin.key.invalid', {
        plugin: plugins.find((plugin) => plugin.resources?.[kind])?.name ?? 'config',
        kind: 'resource',
        key: kind,
        reason: 'No loaded plugin owns this resource kind.',
      });
    }
    out[kind] = collect(kind, own?.[kind], plugins, (plugin) => plugin.resources?.[kind]);
  }
  return out;
}

export function dedupeFieldTypes(types: AnyFieldType[]): AnyFieldType[] {
  const byName = new Map<string, AnyFieldType>();
  for (const type of types) {
    const existing = byName.get(type.name);
    if (existing && existing !== type) {
      throw ManabloxError.conflict('fieldType.name.duplicate', { name: type.name });
    }
    byName.set(type.name, type);
  }
  return [...byName.values()];
}

/**
 * A content type with a plugin's `extend` entry applied: new fields are appended, a field that
 * exists is merged, `settings` and `admin` key by key, so two plugins touching one field keep
 * both their settings.
 */
export function mergeExtension(
  target: ContentTypeInput,
  extension: ContentTypeExtension,
): ContentTypeInput {
  const fields = [...target.fields];
  for (const field of extension.fields ?? []) {
    const index = fields.findIndex((existing) => existing.name === field.name);
    const current = fields[index];
    if (!current) {
      fields.push(field);
      continue;
    }
    fields[index] = {
      ...current,
      ...field,
      settings: { ...(current.settings ?? {}), ...(field.settings ?? {}) },
      admin: { ...(current.admin ?? {}), ...(field.admin ?? {}) },
    } as FieldInput;
  }
  return {
    ...target,
    ...(extension.label !== undefined ? { label: extension.label } : {}),
    ...(extension.icon !== undefined ? { icon: extension.icon } : {}),
    fields,
  };
}
