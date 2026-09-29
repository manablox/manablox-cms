/** Plugin permissions, controls, audit entities, error keys, jobs and services. */

import type { Controls } from './controls/index.js';
import type { ControlScopeKind, RateRule } from './controls/types.js';
import { type ErrorKind, ManabloxError } from './errors.js';
import type { Logger } from './logger.node.js';
import type { Manablox } from './manablox.node.js';
import type { BuiltInRole } from './permissions.js';
import type { Contribution } from './plugin-contributions.js';
import { type StandardSchemaV1, validateStandard } from './standard-schema.js';

/** A callback checked bivariantly, so a plugin typed by its services fits `ManabloxPlugin`. */
export type PluginCallback<A extends unknown[], R> = {
  bivariant(...args: A): R;
}['bivariant'];

/** `<pluginId>:<action>`, e.g. `hello:write`. */
export type PluginPermissionKey = `${string}:${string}`;

export interface PluginPermission {
  key: PluginPermissionKey;
  label: string;
  description?: string;
  /** The role editor's group label; the plugin's own group by default. */
  group?: string;
  /** Built-in roles that hold it besides owner and admin, which hold every plugin permission. */
  roles?: BuiltInRole[];
}

interface ControlSpecBase {
  description: string;
  /** Shown in the admin; the key by default. */
  label?: string;
  /** Default instance, group and space. */
  scopes?: ControlScopeKind[];
}

export interface PluginFeatureSpec extends ControlSpecBase {
  /** Default `true`. */
  enabled?: boolean;
  /**
   * `feature` (default): any scope switching it off wins. `mostSpecific`: the narrowest scope
   * that sets it wins, for flags a space may switch on, such as a badge.
   */
  resolution?: 'feature' | 'mostSpecific';
}

/** Counted by a `counters` entry of one of the plugin's data providers. */
export interface PluginLimitSpec extends ControlSpecBase {
  /** Singular and plural noun for messages, e.g. `['greeting', 'greetings']`. */
  nouns?: [string, string];
}

export interface PluginUsageSpec extends ControlSpecBase {
  nouns?: [string, string];
}

export interface PluginRateSpec extends ControlSpecBase {
  /** `null` (default) is no limit. */
  default?: RateRule | null;
  /**
   * A cap on how many run at once, `{ max }`, taken with `controls.acquire` rather than counted
   * per window; it has no default.
   */
  concurrency?: boolean;
}

export interface PluginRetentionSpec extends ControlSpecBase {
  /** Days or a count; `null` (default) keeps everything. */
  default?: number | null;
}

export interface PluginSettingSpec<T = unknown> extends ControlSpecBase {
  default: T;
  /** Validates stored values; synchronous. */
  schema: StandardSchemaV1<unknown, T>;
}

/**
 * Control keys a plugin declares, by full key: `features.plugins.<id>.*`,
 * `limits.plugins.<id>.*`, `usage.plugins.<id>.*`, `rateLimits.plugins.<id>.*`,
 * `retention.plugins.<id>.*` and settings as `plugins.<id>.*`.
 */
export interface PluginControls {
  [key: `features.plugins.${string}`]: PluginFeatureSpec;
  [key: `limits.plugins.${string}`]: PluginLimitSpec;
  [key: `usage.plugins.${string}`]: PluginUsageSpec;
  [key: `rateLimits.plugins.${string}`]: PluginRateSpec;
  [key: `retention.plugins.${string}`]: PluginRetentionSpec;
  [key: `plugins.${string}`]: PluginSettingSpec;
}

type ControlKind = 'features' | 'limits' | 'usage' | 'rateLimits' | 'retention';

/**
 * A plugin's control keys by kind and short name, as the controls API takes them: `feature`
 * is the plugin's flag, `features.shout` of `hello` is `plugins.hello.shout`, `settings.x` the
 * full setting key. See `controlKeys`.
 */
export type PluginControlKeys<Id extends string, C> = {
  feature: `plugins.${Id}`;
} & {
  [Kind in ControlKind]: {
    [Key in keyof C as Key extends `${Kind}.plugins.${Id}.${infer Short}`
      ? Short
      : never]: Key extends `${Kind}.${infer Full}` ? Full : never;
  };
} & {
  settings: {
    [Key in keyof C as Key extends `plugins.${Id}.${infer Short}` ? Short : never]: Key;
  };
};

/**
 * The keys of a plugin's `controls` declaration, typed from it, so code names a control by
 * its declaration instead of a string: `controlKeys('hello', helloControls).limits.greetings`.
 * Declare the controls with `satisfies PluginControls` to keep their keys.
 */
export function controlKeys<const Id extends string, const C extends PluginControls>(
  id: Id,
  controls: C,
): PluginControlKeys<Id, C> {
  const own = `plugins.${id}.`;
  const kinds: Record<string, Record<string, string>> = {
    features: {},
    limits: {},
    usage: {},
    rateLimits: {},
    retention: {},
    settings: {},
  };
  for (const key of Object.keys(controls)) {
    if (key.startsWith(own)) {
      (kinds.settings as Record<string, string>)[key.slice(own.length)] = key;
      continue;
    }
    const dot = key.indexOf('.');
    const full = key.slice(dot + 1);
    const kind = kinds[key.slice(0, dot)];
    if (kind && full.startsWith(own)) kind[full.slice(own.length)] = full;
  }
  return { feature: `plugins.${id}`, ...kinds } as PluginControlKeys<Id, C>;
}

/** Audit target kinds of a plugin, and who it records as; the admin plugin labels them. */
export interface PluginAudit {
  /** `<id>.<entity>`; entries are recorded as `<id>.<entity>.<verb>`. */
  entities: `${string}.${string}`[];
  /** Actor kinds the plugin records as, e.g. a run of its own: `<id>` or `<id>.<name>`. */
  actorKinds?: string[];
}

/** An error key of a plugin, `plugins.<id>.*`. */
export interface PluginErrorSpec {
  /** Sets the HTTP status; `bad_request` by default. */
  kind?: ErrorKind;
  /** English sentence with `{param}` placeholders. */
  message: string;
}

/** A job handler; the payload's `spaceId`, when set, skips the job where the plugin is off. */
export type PluginJobHandler<S = unknown> = PluginCallback<
  [payload: Record<string, unknown>, plugin: PluginContext<S>],
  Promise<void>
>;

/**
 * A job handler whose payload `schema` checks before `handler` runs; a payload it refuses
 * fails the job with `validation.failed`. Annotate `plugin` to type its services.
 */
export function defineJob<P extends Record<string, unknown>, S = unknown>(
  schema: StandardSchemaV1<unknown, P>,
  handler: (payload: P, plugin: PluginContext<S>) => Promise<void>,
): PluginJobHandler<S> {
  return async (payload, plugin) => {
    const checked = await validateStandard(schema, payload, 'validation');
    if (!checked.ok) throw ManabloxError.validation(checked.issues);
    await handler(checked.value, plugin);
  };
}

/** A payload-less job run every `every` milliseconds by the management worker. */
export interface PluginMaintenanceTask<S = unknown> {
  name: string;
  every: number;
  run: PluginCallback<[plugin: PluginContext<S>], Promise<void>>;
}

/**
 * Services of other plugins by id, for `plugins.get`. A plugin with services others use
 * augments it in its package; consumers import the type only:
 *
 * ```ts
 * declare module '@manablox/core' {
 *   interface PluginServicesMap { hello: HelloServices }
 * }
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by plugin packages
export interface PluginServicesMap {}

/** Other plugins as one plugin, an rpc procedure or a route sees them. */
export interface PluginLookup {
  /** Whether a plugin with this id is configured. */
  has(id: string): boolean;
  /**
   * The services of the plugin with this id; undefined when it is not configured or builds
   * none. Inside `services()` only plugins booted earlier (see `requires`) have theirs.
   */
  get<Id extends keyof PluginServicesMap>(id: Id): PluginServicesMap[Id] | undefined;
  get(id: string): unknown;
  /**
   * The services of the plugin with this id, for a plugin that requires it or reads its own;
   * throws when it is not configured or its services are not built yet.
   */
  require<Id extends keyof PluginServicesMap>(id: Id): PluginServicesMap[Id];
  /** Whether the plugin is configured and its flag is on in the space (`null`: the instance). */
  isOn(id: string, spaceId: string | null): Promise<boolean>;
}

/**
 * Messages between the processes of one instance that share Redis, e.g. to drop a cache
 * another replica made stale. Without Redis there is one process and nothing to send.
 */
export interface PluginChannel<T = unknown> {
  /** Sends a JSON value to the other processes; the sending process does not get it. */
  publish(message: T): void;
  /**
   * Calls `listener` with each message another process sends, and with `undefined` after a
   * reconnect, when messages may have been missed. Returns the unsubscribe function.
   */
  subscribe(listener: (message: T | undefined) => void): () => void;
}

/**
 * A plugin's runtime handles; `@manablox/server` adds `repos`, `db`, `cache` and `jobs`. See
 * `Manablox.plugin`.
 */
export interface PluginContext<S = unknown> {
  /** The plugin's id, see `pluginId`. */
  readonly id: string;
  readonly name: string;
  readonly manablox: Manablox;
  readonly logger: Logger;
  readonly controls: Controls;
  /** Built by `services`; throws until the server has built them. */
  readonly services: S;
  /** Other plugins: their services and flags. */
  readonly plugins: PluginLookup;
  /**
   * The entries configured plugins contributed to one of this plugin's extension points, in
   * boot order, each with its plugin's id. Type them with `ContributionOf<id, point>`. With a
   * space (`null`: the instance), only those whose plugin is on there, while this one is too.
   */
  contributions<T = unknown>(point: string): readonly Contribution<T>[];
  contributions<T = unknown>(
    point: string,
    spaceId: string | null,
  ): Promise<readonly Contribution<T>[]>;
}

/** What `services` receives; `@manablox/server` adds repositories and the core services. */
export interface PluginServicesContext {
  readonly plugin: Omit<PluginContext, 'services'>;
  readonly manablox: Manablox;
  readonly logger: Logger;
}

/** The space a create step writes into. */
export interface PluginCreatedSpace {
  readonly id: string;
  readonly name: string;
  readonly machineName: string;
  /** The space's website address. */
  readonly url: string;
  readonly defaultLocale: string;
  readonly locales: readonly string[];
}

/** What `spaceCreate.apply` gets; `@manablox/services` adds the transaction's `repos`. */
export interface PluginSpaceCreateContext<S = unknown> {
  readonly plugin: PluginContext<S>;
  readonly space: PluginCreatedSpace;
  /** The new space's owner, the creating user in the admin; `null` when it has none. */
  readonly actorId: string | null;
}

/** What `spaceCreate.afterCommit` gets: the committed space, no transaction. */
export interface PluginSpaceCommittedContext<S = unknown> {
  readonly plugin: PluginContext<S>;
  readonly space: PluginCreatedSpace;
  readonly actorId: string | null;
}

/**
 * A plugin's part of a new space: `spaces.create` hands it `plugins[<id>]`, the draft its
 * `space.create.steps` admin entry collected. `D` is the validated draft.
 */
export interface PluginSpaceCreate<S = unknown, D = unknown> {
  /** Checked before anything is written; issues refuse the create. */
  schema?: StandardSchemaV1<unknown, D>;
  /** Runs in the create's transaction, after the starter; a throw refuses the create. */
  apply?: PluginCallback<[context: PluginSpaceCreateContext<S>, data: D], Promise<void>>;
  /**
   * Runs once the space is committed, after the starter, its group and the code resources.
   * A returned sentence, or the message of a throw, reaches the caller as a warning; the
   * space stays.
   */
  afterCommit?: PluginCallback<
    [context: PluginSpaceCommittedContext<S>, data: D],
    // biome-ignore lint/suspicious/noConfusingVoidType: a step with nothing to report returns nothing
    Promise<string | null | undefined | void>
  >;
}
