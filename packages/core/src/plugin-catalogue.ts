/** Checks plugin permissions, controls, audit entities, error keys and jobs, and registers them. */

import { setPluginAudit } from './audit.js';
import {
  type ControlEntry,
  type ControlKind,
  controlEntry,
  pluginControlEntry,
  pluginControlKind,
  pluginOfControl,
  setPluginControls,
} from './controls/catalogue.js';
import { setPluginErrors } from './error-keys.js';
import { type ErrorKind, ManabloxError } from './errors.js';
import { ALL_PERMISSIONS, isBuiltInRole, setPluginPermissions } from './permissions.js';
import { type ManabloxPlugin, pluginFeatureKey, pluginId } from './plugin.js';
import type { PluginControls, PluginErrorSpec } from './plugin-extensions.js';

/** A name segment after a plugin prefix: `extra`, `forms.ip`, `send-mail`. */
const NAME = /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)*$/i;
/** One segment: permission actions and audit entities. */
const SEGMENT = /^[a-z][a-z0-9_-]*$/i;

const ERROR_KINDS: ReadonlySet<ErrorKind> = new Set([
  'validation',
  'not_found',
  'conflict',
  'forbidden',
  'unauthorized',
  'bad_request',
  'too_large',
  'rate_limited',
  'locked',
  'unavailable',
  'internal',
]);

/** Core permission prefixes a plugin id may not take, e.g. `content`. */
const CORE_PERMISSION_PREFIXES = new Set(
  ALL_PERMISSIONS.map((permission) => permission.slice(0, permission.indexOf(':'))),
);

const invalid = (plugin: string, kind: string, key: string, reason: string) =>
  ManabloxError.badRequest('plugin.key.invalid', { plugin, kind, key, reason });

const duplicate = (kind: string, key: string, plugins: string[]) =>
  ManabloxError.conflict('plugin.key.duplicate', { kind, key, plugins });

/** Whether a plugin declares anything the catalogue keeps. */
const declares = (plugin: ManabloxPlugin) =>
  Boolean(
    plugin.permissions?.length ||
      Object.keys(plugin.controls ?? {}).length ||
      plugin.audit?.entities.length ||
      plugin.audit?.actorKinds?.length ||
      Object.keys(plugin.errors ?? {}).length ||
      Object.keys(plugin.jobs ?? {}).length ||
      plugin.maintenance?.length,
  );

/**
 * Validates what the plugins declare and replaces each plugin's entries in the permission,
 * control, audit and error catalogues. Throws before registering anything.
 */
export function registerPluginCatalogue(plugins: readonly ManabloxPlugin[]): void {
  const ids = new Map<string, string>();
  const flags = new Map<string, string>();
  for (const plugin of plugins) {
    flags.set(`features.${pluginFeatureKey(plugin)}`, plugin.name);
    if (!declares(plugin)) continue;
    const id = pluginId(plugin.name);
    const other = ids.get(id);
    if (other !== undefined) {
      throw ManabloxError.conflict('plugin.id.duplicate', { id, plugins: [other, plugin.name] });
    }
    ids.set(id, plugin.name);
  }

  const controlOwners = new Map<string, string>();
  const checked = plugins.filter(declares).map((plugin) => {
    const id = pluginId(plugin.name);
    return {
      plugin,
      id,
      permissions: checkPermissions(plugin, id),
      controls: checkControls(plugin, id, flags, controlOwners),
      audit: checkAudit(plugin, id),
      errors: checkErrors(plugin, id),
      jobs: checkJobs(plugin),
    };
  });

  for (const { plugin, id, controls, errors } of checked) {
    setPluginPermissions(id, {
      label: plugin.name,
      description: plugin.description ?? '',
      permissions: plugin.permissions ?? [],
    });
    setPluginControls(id, controls);
    setPluginAudit(id, plugin.audit?.entities ?? [], plugin.audit?.actorKinds ?? []);
    setPluginErrors(id, errors);
  }
}

function checkPermissions(plugin: ManabloxPlugin, id: string): void {
  const seen = new Set<string>();
  for (const permission of plugin.permissions ?? []) {
    const { key } = permission;
    const colon = key.indexOf(':');
    const action = key.slice(colon + 1);
    if (key.slice(0, colon) !== id || !SEGMENT.test(action)) {
      throw invalid(plugin.name, 'permission', key, `Expected "${id}:<action>".`);
    }
    if (CORE_PERMISSION_PREFIXES.has(id)) {
      throw invalid(plugin.name, 'permission', key, `"${id}" is a core permission prefix.`);
    }
    if (seen.has(key)) throw duplicate('permission', key, [plugin.name]);
    seen.add(key);
    if (!permission.label?.trim()) throw invalid(plugin.name, 'permission', key, 'No label.');
    for (const role of permission.roles ?? []) {
      if (!isBuiltInRole(role)) {
        throw invalid(plugin.name, 'permission', key, `"${role}" is not a built-in role.`);
      }
    }
  }
}

const PREFIX: Record<ControlKind, string> = {
  feature: 'features.plugins.',
  limit: 'limits.plugins.',
  usage: 'usage.plugins.',
  rateLimit: 'rateLimits.plugins.',
  retention: 'retention.plugins.',
  setting: 'plugins.',
  upload: '',
  message: '',
  state: '',
};

function checkControls(
  plugin: ManabloxPlugin,
  id: string,
  flags: ReadonlyMap<string, string>,
  owners: Map<string, string>,
): Map<string, ControlEntry> {
  const out = new Map<string, ControlEntry>();
  for (const [key, spec] of Object.entries((plugin.controls ?? {}) as PluginControls)) {
    const kind = pluginControlKind(key);
    const prefix = kind ? `${PREFIX[kind]}${id}.` : null;
    if (!prefix || !key.startsWith(prefix) || !NAME.test(key.slice(prefix.length))) {
      throw invalid(
        plugin.name,
        'control',
        key,
        `Expected "<features|limits|usage|rateLimits|retention>.plugins.${id}.<name>" or "plugins.${id}.<name>".`,
      );
    }
    const flagOf = flags.get(key);
    if (flagOf !== undefined) throw duplicate('control', key, [flagOf, plugin.name]);
    const owner = owners.get(key);
    if (owner !== undefined) throw duplicate('control', key, [owner, plugin.name]);
    // Plugin flags match `features.plugins.*` too; only a core key is refused here.
    const core = pluginOfControl(key) === null ? controlEntry(key) : null;
    if (core && !key.startsWith('features.plugins.')) {
      throw duplicate('control', key, ['core', plugin.name]);
    }
    if (!spec?.description?.trim()) throw invalid(plugin.name, 'control', key, 'No description.');
    const entry = pluginControlEntry(key, spec);
    if (!entry) throw invalid(plugin.name, 'control', key, 'Unknown kind.');
    owners.set(key, plugin.name);
    out.set(key, entry);
  }
  return out;
}

function checkAudit(plugin: ManabloxPlugin, id: string): void {
  const seen = new Set<string>();
  for (const key of plugin.audit?.entities ?? []) {
    if (
      typeof key !== 'string' ||
      !key.startsWith(`${id}.`) ||
      !SEGMENT.test(key.slice(id.length + 1))
    ) {
      throw invalid(plugin.name, 'audit', String(key), `Expected "${id}.<entity>".`);
    }
    if (seen.has(key)) throw duplicate('audit', key, [plugin.name]);
    seen.add(key);
  }
  for (const kind of plugin.audit?.actorKinds ?? []) {
    const own =
      typeof kind === 'string' &&
      (kind === id || (kind.startsWith(`${id}.`) && SEGMENT.test(kind.slice(id.length + 1))));
    if (!own)
      throw invalid(plugin.name, 'audit', String(kind), `Expected "${id}" or "${id}.<name>".`);
    if (seen.has(`actor:${kind}`)) throw duplicate('audit', kind, [plugin.name]);
    seen.add(`actor:${kind}`);
  }
}

function checkErrors(plugin: ManabloxPlugin, id: string): Record<string, PluginErrorSpec> {
  const errors = (plugin.errors ?? {}) as Record<string, PluginErrorSpec>;
  const prefix = `plugins.${id}.`;
  for (const [key, spec] of Object.entries(errors)) {
    if (!key.startsWith(prefix) || !NAME.test(key.slice(prefix.length))) {
      throw invalid(plugin.name, 'error', key, `Expected "${prefix}<name>".`);
    }
    if (!spec?.message?.trim()) throw invalid(plugin.name, 'error', key, 'No message.');
    if (spec.kind !== undefined && !ERROR_KINDS.has(spec.kind)) {
      throw invalid(plugin.name, 'error', key, `Unknown kind "${spec.kind}".`);
    }
  }
  return errors;
}

function checkJobs(plugin: ManabloxPlugin): void {
  const seen = new Set<string>();
  const names = [
    ...Object.keys(plugin.jobs ?? {}),
    ...(plugin.maintenance ?? []).map((task) => task.name),
  ];
  for (const name of names) {
    if (!NAME.test(name)) throw invalid(plugin.name, 'job', name, 'Expected a plain name.');
    if (seen.has(name)) throw duplicate('job', name, [plugin.name]);
    seen.add(name);
  }
  for (const task of plugin.maintenance ?? []) {
    if (!Number.isSafeInteger(task.every) || task.every < 1000) {
      throw invalid(plugin.name, 'job', task.name, 'Runs at most once a second.');
    }
  }
}

/** A plugin as the admin sees it: its flag, the labels of what it declares and its audit keys. */
export interface PluginDescription {
  id: string;
  name: string;
  version: string | null;
  description: string | null;
  feature: string;
  permissions: Array<{ key: string; label: string; description: string; group: string | null }>;
  controls: Array<{ key: string; kind: ControlKind; label: string; description: string }>;
  /** Singular and plural noun of limits and usage metrics, by key suffix. */
  nouns: Record<string, [string, string]>;
  /** Audit target kinds; labelled by the admin plugin. */
  audit: string[];
  errors: Record<string, string>;
}

/** The loaded plugins, for the admin's labels. */
export function describePlugins(plugins: readonly ManabloxPlugin[]): PluginDescription[] {
  return plugins.map((plugin) => {
    const controls = Object.entries((plugin.controls ?? {}) as PluginControls);
    return {
      id: pluginId(plugin.name),
      name: plugin.name,
      version: plugin.version ?? null,
      description: plugin.description ?? null,
      feature: pluginFeatureKey(plugin),
      permissions: (plugin.permissions ?? []).map((permission) => ({
        key: permission.key,
        label: permission.label,
        description: permission.description ?? '',
        group: permission.group ?? null,
      })),
      controls: controls.map(([key, spec]) => ({
        key,
        kind: pluginControlKind(key) ?? 'setting',
        label: spec.label ?? key,
        description: spec.description,
      })),
      nouns: Object.fromEntries(
        controls.flatMap(([key, spec]) => {
          const nouns = (spec as { nouns?: [string, string] }).nouns;
          return nouns ? [[key.slice(key.indexOf('.') + 1), nouns]] : [];
        }),
      ),
      audit: [...(plugin.audit?.entities ?? [])],
      errors: Object.fromEntries(
        Object.entries((plugin.errors ?? {}) as Record<string, PluginErrorSpec>).map(
          ([key, spec]) => [key, spec.message],
        ),
      ),
    };
  });
}
