/** Every control key: its kind, value parser, default, allowed scopes and meaning. */

import type { ErrorDetail } from '../errors.js';
import type {
  PluginControls,
  PluginFeatureSpec,
  PluginRateSpec,
  PluginSettingSpec,
} from '../plugin-extensions.js';
import type { StandardSchemaV1 } from '../standard-schema.js';
import type {
  AdminBanner,
  AdminLinks,
  ConcurrencyRule,
  ControlScopeKind,
  FeatureControl,
  LimitControl,
  RateRule,
  SnapshotInterval,
  StateControl,
} from './types.js';
import {
  boolean,
  type ControlIssue,
  integer,
  list,
  nullable,
  object,
  oneOf,
  type Parser,
  plainText,
  refine,
  text,
  url,
} from './validators.js';

/** Bumped when keys, shapes or defaults change. */
export const CONTROL_CATALOGUE_VERSION = '1';

export type ControlKind =
  | 'feature'
  | 'limit'
  | 'usage'
  | 'rateLimit'
  | 'retention'
  | 'upload'
  | 'message'
  | 'setting'
  | 'state';

/** How the values of instance, group and space combine. */
export type ControlResolution =
  | 'feature'
  | 'mostSpecific'
  | 'perScope'
  | 'strictestMax'
  | 'mimeIntersection'
  | 'concat'
  | 'severest';

export interface ControlEntry<T = unknown> {
  kind: ControlKind;
  scopes: readonly ControlScopeKind[];
  default: T;
  parse: Parser<T>;
  resolution: ControlResolution;
  description: string;
  /** The default differs from how an instance without controls behaved before. */
  restrictsByDefault?: true;
  /** A reason when `value` is not allowed at `kind`, beyond `scopes`. */
  scopeCheck?(value: T, kind: ControlScopeKind): string | null;
}

const I = ['instance'] as const;
const IG = ['instance', 'group'] as const;
const IS = ['instance', 'space'] as const;
const IGS = ['instance', 'group', 'space'] as const;

const entry = <T>(value: ControlEntry<T>): ControlEntry<T> => value;

const featureParser: Parser<FeatureControl> = object(
  {
    enabled: boolean(),
    presentation: oneOf(['hidden', 'locked']),
    message: plainText({ max: 500 }),
    link: url(),
  },
  ['presentation', 'message', 'link'],
);

const feature = (
  scopes: readonly ControlScopeKind[],
  description: string,
  options: { enabled?: boolean; resolution?: ControlResolution } = {},
): ControlEntry<FeatureControl> => ({
  kind: 'feature',
  scopes,
  default: { enabled: options.enabled ?? true },
  parse: featureParser,
  resolution: options.resolution ?? 'feature',
  description,
  ...(options.enabled === false ? { restrictsByDefault: true as const } : {}),
});

const limitShape = object(
  {
    max: nullable(integer({ min: 0 })),
    mode: oneOf(['hard', 'soft', 'off']),
    thresholds: list(integer({ min: 1, max: 1000 }), { max: 10 }),
  },
  ['mode', 'thresholds'],
);

/** `mode` defaults to `hard`. */
const limitParser: Parser<LimitControl> = (value, path, issues) => {
  const parsed = limitShape(value, path, issues);
  return parsed && { ...parsed, mode: parsed.mode ?? 'hard' };
};

const limit = (
  kind: 'limit' | 'usage',
  scopes: readonly ControlScopeKind[],
  description: string,
): ControlEntry<LimitControl> => ({
  kind,
  scopes,
  default: { max: null, mode: 'hard' },
  parse: limitParser,
  resolution: 'perScope',
  description,
});

const rateParser: Parser<RateRule | null> = nullable(
  object({ max: integer({ min: 0 }), windowSeconds: integer({ min: 1, max: 86_400 }) }),
);

const rate = (
  scopes: readonly ControlScopeKind[],
  defaultRule: RateRule | null,
  description: string,
  restrictsByDefault = false,
): ControlEntry<RateRule | null> => ({
  kind: 'rateLimit',
  scopes,
  default: defaultRule,
  parse: rateParser,
  resolution: 'mostSpecific',
  description,
  ...(restrictsByDefault ? { restrictsByDefault: true as const } : {}),
});

const concurrency = (
  scopes: readonly ControlScopeKind[],
  description: string,
): ControlEntry<ConcurrencyRule | null> => ({
  kind: 'rateLimit',
  scopes,
  default: null,
  parse: nullable(object({ max: integer({ min: 0 }) })),
  resolution: 'mostSpecific',
  description,
});

const retention = (
  scopes: readonly ControlScopeKind[],
  description: string,
  defaultValue: number | null = null,
): ControlEntry<number | null> => ({
  kind: 'retention',
  scopes,
  default: defaultValue,
  parse: nullable(integer({ min: 1, max: 36_500 })),
  resolution: 'mostSpecific',
  description,
  ...(defaultValue !== null ? { restrictsByDefault: true as const } : {}),
});

/** An exact type (`image/png`) or a family (`image/`). */
const mimeEntry = refine(text({ min: 2, max: 255 }), (value) =>
  /^[a-z0-9][\w.+-]*\/[\w.+-]*$/i.test(value) ? null : 'Expected a MIME type or family.',
);

const bannerParser: Parser<AdminBanner> = object(
  {
    id: refine(text({ min: 1, max: 64 }), (value) =>
      /^[\w.:-]+$/.test(value) ? null : 'Letters, digits, `_`, `.`, `:` and `-` only.',
    ),
    level: oneOf(['info', 'warning', 'danger']),
    text: plainText({ min: 1, max: 500 }),
    link: url(),
    dismissible: boolean(),
    audience: oneOf(['all', 'superadmin']),
  },
  ['link'],
);

const linksParser: Parser<AdminLinks> = object(
  { upgrade: url(), billing: url(), support: url(), docs: url() },
  ['upgrade', 'billing', 'support', 'docs'],
);

const stateParser: Parser<StateControl> = object(
  { status: oneOf(['active', 'readOnly', 'suspended']), message: plainText({ max: 1000 }) },
  ['message'],
);

/** The kind a plugin-declared key has by its prefix; `null` outside the plugin namespaces. */
export function pluginControlKind(key: string): ControlKind | null {
  if (key.startsWith('features.plugins.')) return 'feature';
  if (key.startsWith('limits.plugins.')) return 'limit';
  if (key.startsWith('usage.plugins.')) return 'usage';
  if (key.startsWith('rateLimits.plugins.')) return 'rateLimit';
  if (key.startsWith('retention.plugins.')) return 'retention';
  if (key.startsWith('plugins.')) return 'setting';
  return null;
}

/** A catalogue entry for a plugin-declared key; `null` outside the plugin namespaces. */
export function pluginControlEntry(key: string, spec: PluginControlSpec): ControlEntry | null {
  const scopes = spec.scopes ?? IGS;
  switch (pluginControlKind(key)) {
    case 'feature': {
      const { enabled, resolution } = spec as PluginFeatureSpec;
      return feature(scopes, spec.description, {
        ...(enabled === undefined ? {} : { enabled }),
        ...(resolution ? { resolution } : {}),
      });
    }
    case 'limit':
      return limit('limit', scopes, spec.description);
    case 'usage':
      return limit('usage', scopes, spec.description);
    case 'rateLimit':
      if ((spec as PluginRateSpec).concurrency) return concurrency(scopes, spec.description);
      return rate(scopes, (spec as PluginRateSpec).default ?? null, spec.description);
    case 'retention':
      return retention(scopes, spec.description, (spec as { default?: number | null }).default);
    case 'setting': {
      const { schema, default: fallback } = spec as PluginSettingSpec;
      return entry<unknown>({
        kind: 'setting',
        scopes,
        default: fallback,
        parse: schemaParser(schema),
        resolution: 'mostSpecific',
        description: spec.description,
      });
    }
    default:
      return null;
  }
}

type PluginControlSpec = PluginControls[keyof PluginControls];

/** A synchronous standard schema as a control value parser. */
function schemaParser<T>(schema: StandardSchemaV1<unknown, T>): Parser<T> {
  return (value, path, issues) => {
    const result = schema['~standard'].validate(value);
    if (result instanceof Promise) {
      issues.push({ path, message: 'The setting schema must validate synchronously.' });
      return undefined as T;
    }
    if (result.issues) {
      for (const issue of result.issues) {
        const at = (issue.path ?? []).map((segment) => {
          const key = typeof segment === 'object' ? segment.key : segment;
          return typeof key === 'symbol' ? String(key) : key;
        });
        issues.push({ path: [...path, ...at], message: issue.message });
      }
      return undefined as T;
    }
    return result.value;
  };
}

export const CONTROL_CATALOGUE = {
  // Feature flags
  'features.customRoles': feature(IGS, 'Custom roles beyond the built-in ones.'),
  'features.approvals': feature(IGS, 'Approval before publishing.'),
  'features.scheduledPublishing': feature(IGS, 'Scheduled publishing of documents and assets.'),
  'features.versionRestore': feature(IGS, 'Restoring an earlier document version.'),
  'features.visualEditor': feature(IGS, 'The visual editor and its preview reads.'),
  'features.databags': feature(IGS, 'Content types of kind data.'),
  'features.menus': feature(IGS, 'Editing menus.'),
  'features.tags': feature(IGS, 'Editing tags.'),
  'features.apiKeys': feature(I, 'Issuing API keys.'),
  'features.graphqlDelivery': feature(IS, 'The public GraphQL API.'),
  'features.restDelivery': feature(IS, 'The public REST API.'),
  'features.transferExport': feature(IS, 'Space export.'),
  'features.transferImport': feature(IS, 'Space import.'),
  'features.customDomains': feature(IGS, 'Custom domains: API hosts and plugin host names.'),
  'features.twoFactor': feature(I, 'Two-factor authentication.'),
  'features.sso': feature(I, 'Single sign-on providers.'),
  'features.snapshots': feature(IGS, 'Space snapshots and restore.'),
  'features.environments': feature(IGS, 'Environments besides production, such as staging.'),
  'features.plugins.*': feature(
    IGS,
    'A plugin, by id: its fields, actions, hooks, routes, procedures and jobs.',
  ),
  'features.spaceCreate': feature(IG, 'Creating and importing spaces.'),

  // Count limits
  'limits.spaces': limit('limit', IG, 'Spaces.'),
  'limits.seats': limit('limit', IGS, 'Users with a membership in the scope.'),
  'limits.contentTypes': limit('limit', IGS, 'Content and block types.'),
  'limits.documents': limit('limit', IGS, 'Documents, all locales.'),
  'limits.databagTypes': limit('limit', IGS, 'Databag types.'),
  'limits.databagEntries': limit('limit', IGS, 'Databag entries, plugin records included.'),
  'limits.localesPerSpace': limit('limit', IGS, 'Locales of one space.'),
  'limits.menusPerSpace': limit('limit', IGS, 'Menus of one space.'),
  'limits.apiKeys': limit('limit', I, 'API keys.'),
  'limits.customDomains': limit('limit', IGS, 'Custom domains: API hosts and plugin host names.'),
  'limits.redirectsPerSpace': limit('limit', IGS, 'Redirects of one space.'),
  'limits.customRolesPerSpace': limit('limit', IGS, 'Custom roles of one space.'),
  'limits.storageBytes': limit('limit', IGS, 'Stored asset bytes, originals and variants.'),
  'limits.environmentsPerSpace': limit(
    'limit',
    IGS,
    'Staging environments of one space; 0 allows none.',
  ),

  // Usage limits per period
  'usage.apiRequests': limit('usage', IGS, 'Delivery and API-key requests per period.'),
  'usage.bandwidthBytes': limit(
    'usage',
    IGS,
    'Bytes served per period, external figures included.',
  ),
  'usage.mails': limit('usage', IGS, 'Mails sent per period.'),
  'usage.uploads': limit('usage', IGS, 'Uploads per period.'),
  usagePeriodAnchorDay: entry<number>({
    kind: 'setting',
    scopes: I,
    default: 1,
    parse: integer({ min: 1, max: 28 }),
    resolution: 'mostSpecific',
    description: 'Day of the month a usage period starts.',
  }),

  // Rate limits; `null` is no limit
  'rateLimits.delivery.space': rate(IGS, null, 'Delivery requests per space.'),
  'rateLimits.delivery.ip': rate(IS, { max: 300, windowSeconds: 60 }, 'Delivery requests per IP.'),
  'rateLimits.management.apiKey': rate(
    I,
    { max: 600, windowSeconds: 60 },
    'Management requests per API key.',
  ),
  'rateLimits.management.session': rate(
    I,
    { max: 600, windowSeconds: 60 },
    'Management requests per user.',
  ),
  'rateLimits.uploads': rate(IGS, null, 'Uploads per space.'),
  'rateLimits.uploads.parallel': concurrency(IGS, 'Parallel uploads per space.'),
  'rateLimits.transfer': rate(IS, null, 'Exports and imports per space.'),
  'rateLimits.auth.signIn': rate(
    I,
    { max: 5, windowSeconds: 900 },
    'Failed sign-ins per IP and account before backoff.',
  ),
  'rateLimits.auth.mails': rate(
    I,
    { max: 3, windowSeconds: 3600 },
    'Auth mails per account.',
    true,
  ),
  'rateLimits.graphql.depth': entry<number>({
    kind: 'rateLimit',
    scopes: IS,
    default: 8,
    parse: integer({ min: 1, max: 100 }),
    resolution: 'mostSpecific',
    description: 'Maximum GraphQL query depth.',
  }),
  'rateLimits.graphql.complexity': entry<number>({
    kind: 'rateLimit',
    scopes: IS,
    default: 1000,
    parse: integer({ min: 1, max: 1_000_000 }),
    resolution: 'mostSpecific',
    description: 'Maximum GraphQL query complexity.',
  }),

  // Retention in days (or a count); `null` keeps everything
  'retention.versionsDays': retention(IGS, 'Content versions.'),
  'retention.auditDays': retention(IGS, 'Audit entries.'),
  'retention.auditExport': entry<boolean>({
    kind: 'retention',
    scopes: I,
    default: false,
    parse: boolean(),
    resolution: 'mostSpecific',
    description: 'Exports audit entries to storage before pruning.',
  }),
  'retention.notificationsDays': retention(I, 'Notifications.'),
  'retention.snapshotsDays': retention(IGS, 'Snapshots.', 7),
  'retention.controlEventsDays': retention(I, 'Control events in the outbox.', 30),

  // Upload rules; the strictest of env, instance, group and space applies
  'uploads.maxFileSize': entry<number | null>({
    kind: 'upload',
    scopes: IGS,
    default: null,
    parse: nullable(integer({ min: 1 })),
    resolution: 'strictestMax',
    description: 'Largest upload in bytes.',
  }),
  'uploads.allowedMimeTypes': entry<string[] | null>({
    kind: 'upload',
    scopes: IGS,
    default: null,
    parse: nullable(list(mimeEntry, { min: 1, max: 200 })),
    resolution: 'mimeIntersection',
    description: 'Allowed MIME types or families (`image/`).',
  }),

  // Admin messages
  'admin.banners': entry<AdminBanner[]>({
    kind: 'message',
    scopes: IGS,
    default: [],
    // Ids key the dismissals.
    parse: refine(list(bannerParser, { max: 20 }), (banners) =>
      new Set(banners.map((banner) => banner.id)).size === banners.length
        ? null
        : 'Banner ids must be unique.',
    ),
    resolution: 'concat',
    description: 'Banners in the admin shell; every scope adds its own.',
  }),
  'admin.links': entry<AdminLinks>({
    kind: 'message',
    scopes: I,
    default: {},
    parse: linksParser,
    resolution: 'mostSpecific',
    description: 'Upgrade, billing, support and docs links in the admin.',
  }),

  // Settings
  'snapshots.interval': entry<SnapshotInterval | null>({
    kind: 'setting',
    scopes: IGS,
    default: null,
    parse: nullable(oneOf(['daily', 'hourly'])),
    resolution: 'mostSpecific',
    description: 'How often snapshots are taken; `null` takes none automatically.',
  }),
  'domains.requireVerification': entry<boolean>({
    kind: 'setting',
    scopes: I,
    default: false,
    parse: boolean(),
    resolution: 'mostSpecific',
    description: 'Custom domains need a DNS check before they serve.',
  }),
  'auth.requireEmailVerification': entry<boolean>({
    kind: 'setting',
    scopes: I,
    default: false,
    parse: boolean(),
    resolution: 'mostSpecific',
    description: 'Accounts confirm their email address by mail before they can sign in.',
  }),
  apiKeysDisable: entry<boolean>({
    kind: 'setting',
    scopes: I,
    default: false,
    parse: boolean(),
    resolution: 'mostSpecific',
    description: 'Existing API keys stop working.',
  }),

  // State
  state: entry<StateControl>({
    kind: 'state',
    scopes: IGS,
    default: { status: 'active' },
    parse: stateParser,
    resolution: 'severest',
    description: 'Active, read-only (writes refused) or suspended (instance only).',
    scopeCheck: (value, kind) =>
      value.status === 'suspended' && kind !== 'instance'
        ? 'Only the instance can be suspended.'
        : null,
  }),
};

type Catalogue = typeof CONTROL_CATALOGUE;
type CatalogueKey = keyof Catalogue;
type ValueOf<E> = E extends ControlEntry<infer T> ? T : never;
type Suffix<K, P extends string> = K extends `${P}${infer R}` ? R : never;

/** A plugin's flag (`plugins.<id>`) or one of its declared features (`plugins.<id>.<name>`). */
export type PluginFeatureKey = `plugins.${string}`;
/** The suffix of a plugin-declared limit, usage metric, rate rule or retention key. */
export type PluginControlSuffix = `plugins.${string}`;
export type FeatureKey = Exclude<Suffix<CatalogueKey, 'features.'>, 'plugins.*'> | PluginFeatureKey;
export type LimitKey = Suffix<CatalogueKey, 'limits.'>;
export type UsageMetric = Suffix<CatalogueKey, 'usage.'>;
export type RateRuleKey = Suffix<CatalogueKey, 'rateLimits.'>;
export type RetentionKey = Suffix<CatalogueKey, 'retention.'>;
/** A core limit or a plugin's `plugins.<id>.<name>`. */
export type AnyLimitKey = LimitKey | PluginControlSuffix;
export type AnyUsageMetric = UsageMetric | PluginControlSuffix;
export type AnyRateRuleKey = RateRuleKey | PluginControlSuffix;
export type AnyRetentionKey = RetentionKey | PluginControlSuffix;
/** A plugin setting, `plugins.<id>.<name>`. */
export type PluginSettingKey = `plugins.${string}`;

/** Stored plugin keys: flags, declared controls and settings. */
export type PluginControlKey =
  | `features.${PluginFeatureKey}`
  | `limits.${PluginControlSuffix}`
  | `usage.${PluginControlSuffix}`
  | `rateLimits.${PluginControlSuffix}`
  | `retention.${PluginControlSuffix}`
  | PluginSettingKey;

/** A stored control key; plugin flags are `features.plugins.<pluginId>`. */
export type ControlKey = Exclude<CatalogueKey, 'features.plugins.*'> | PluginControlKey;

/** The value type of each control key. */
export type ControlValues = {
  [K in Exclude<CatalogueKey, 'features.plugins.*'>]: ValueOf<Catalogue[K]>;
} & { [K in `features.${PluginFeatureKey}`]: FeatureControl } & {
  [K in `limits.${PluginControlSuffix}` | `usage.${PluginControlSuffix}`]: LimitControl;
} & { [K in `rateLimits.${PluginControlSuffix}`]: RateRule | null } & {
  [K in `retention.${PluginControlSuffix}`]: number | null;
} & { [K in PluginSettingKey]: unknown };

export type ControlValue<K extends ControlKey> = K extends keyof ControlValues
  ? ControlValues[K]
  : never;

export const featureControlKey = (key: FeatureKey): ControlKey => `features.${key}`;
export const limitControlKey = (key: AnyLimitKey): ControlKey => `limits.${key}`;
export const usageControlKey = (metric: AnyUsageMetric): ControlKey => `usage.${metric}`;
export const rateRuleControlKey = (rule: AnyRateRuleKey): ControlKey => `rateLimits.${rule}`;
export const retentionControlKey = (key: AnyRetentionKey): ControlKey => `retention.${key}`;

const PLUGIN_PREFIX = 'features.plugins.';
const PLUGIN_ID = /^[a-z0-9][a-z0-9._-]{0,99}$/i;

/** Plugin-declared entries by stored key, with the id of the plugin that declared them. */
const pluginEntries = new Map<string, { plugin: string; entry: ControlEntry }>();

/** Replaces one plugin's declared entries; checked by `resolveConfig`. */
export function setPluginControls(id: string, entries: ReadonlyMap<string, ControlEntry>): void {
  for (const [key, found] of pluginEntries) if (found.plugin === id) pluginEntries.delete(key);
  for (const [key, entry] of entries) pluginEntries.set(key, { plugin: id, entry });
}

/** The plugin that declared a stored key, if any. */
export function pluginOfControl(key: string): string | null {
  return pluginEntries.get(key)?.plugin ?? null;
}

/**
 * The catalogue entry of a stored key, or `null` for an unknown key. A key a plugin declares
 * wins over the `features.plugins.<id>` pattern of plugin flags.
 */
export function controlEntry(key: string): ControlEntry | null {
  const declared = pluginEntries.get(key);
  if (declared) return declared.entry;
  if (key.startsWith(PLUGIN_PREFIX)) {
    return PLUGIN_ID.test(key.slice(PLUGIN_PREFIX.length))
      ? (CONTROL_CATALOGUE['features.plugins.*'] as ControlEntry)
      : null;
  }
  if (key === 'features.plugins.*' || !Object.hasOwn(CONTROL_CATALOGUE, key)) return null;
  return CONTROL_CATALOGUE[key as CatalogueKey] as ControlEntry;
}

export function isControlKey(key: string): key is ControlKey {
  return controlEntry(key) !== null;
}

export function isScopeAllowed(key: string, kind: ControlScopeKind): boolean {
  return controlEntry(key)?.scopes.includes(kind) ?? false;
}

export function controlDefault<K extends ControlKey>(key: K): ControlValue<K> {
  const found = controlEntry(key);
  if (!found) throw new Error(`Unknown control key: ${key}`);
  return structuredClone(found.default) as ControlValue<K>;
}

export type ControlValidation<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; issues: ErrorDetail[] };

/** Checks one (key, value) pair; with `kind`, also that the key and value fit that scope. */
export function validateControl<K extends ControlKey>(
  key: K,
  value: unknown,
  kind?: ControlScopeKind,
): ControlValidation<ControlValue<K>>;
export function validateControl(
  key: string,
  value: unknown,
  kind?: ControlScopeKind,
): ControlValidation;
export function validateControl(
  key: string,
  value: unknown,
  kind?: ControlScopeKind,
): ControlValidation {
  const found = controlEntry(key);
  if (!found) {
    return { ok: false, issues: [{ key: 'control.key.unknown', params: { key } }] };
  }
  if (kind && !found.scopes.includes(kind)) {
    return {
      ok: false,
      issues: [{ key: 'control.scope.notAllowed', params: { key, scope: kind } }],
    };
  }
  const issues: ControlIssue[] = [];
  const parsed = found.parse(value, [], issues);
  if (issues.length === 0 && kind) {
    const reason = found.scopeCheck?.(parsed, kind);
    if (reason) issues.push({ path: [], message: reason });
  }
  if (issues.length > 0) {
    return {
      ok: false,
      issues: issues.map((issue) => ({
        key: 'control.value.invalid',
        path: issue.path,
        params: { key, message: issue.message },
      })),
    };
  }
  return { ok: true, value: parsed };
}

/** A catalogue entry as JSON, for the control API and docs. */
export interface ControlDescription {
  key: string;
  kind: ControlKind;
  scopes: readonly ControlScopeKind[];
  default: unknown;
  description: string;
  restrictsByDefault: boolean;
  /** A key pattern; `*` stands for a plugin id. */
  pattern: boolean;
}

export function describeControls(): ControlDescription[] {
  const entries: Array<[string, ControlEntry]> = [
    ...(Object.entries(CONTROL_CATALOGUE) as Array<[string, ControlEntry]>),
    ...[...pluginEntries].map(([key, { entry }]): [string, ControlEntry] => [key, entry]),
  ];
  return entries.map(([key, found]) => ({
    key,
    kind: found.kind,
    scopes: found.scopes,
    default: found.default,
    description: found.description,
    restrictsByDefault: found.restrictsByDefault === true,
    pattern: key.includes('*'),
  }));
}

/** Every fixed key with its entry, plugin-declared ones last; the plugin pattern is left out. */
export function catalogueEntries(): [ControlKey, ControlEntry][] {
  return [
    ...Object.entries(CONTROL_CATALOGUE)
      .filter(([key]) => !key.includes('*'))
      .map(([key, value]): [ControlKey, ControlEntry] => [
        key as ControlKey,
        value as ControlEntry,
      ]),
    ...[...pluginEntries].map(([key, { entry }]): [ControlKey, ControlEntry] => [
      key as ControlKey,
      entry,
    ]),
  ];
}

/** Every usage metric, core then the registered plugins'. */
export function usageMetrics(): AnyUsageMetric[] {
  return catalogueEntries()
    .map(([key]) => key)
    .filter((key) => key.startsWith('usage.'))
    .map((key) => key.slice('usage.'.length) as AnyUsageMetric);
}
