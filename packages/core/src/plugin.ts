import type { PluginResourceEntry, PluginResourceKind } from './code-resource.js';
import type { ContentTypeInput, FieldInput } from './content-type.js';
import type { FeatureKey } from './controls/catalogue.js';
import type { FeatureCeilingProvider } from './controls/ceilings.js';
import type { CredentialDefinition } from './credential-define.js';
import type { PluginErrorKey } from './error-keys.js';
import type { ManabloxHooks } from './hook-map.js';
import type { HookHandler } from './hooks.js';
import type { PluginBlocks, PluginContentTypeData } from './plugin-blocks.js';
import type { ExtensionPointSpec, PluginContributionMap } from './plugin-contributions.js';
import type { PluginDataProvider } from './plugin-data.js';
import type {
  PluginAudit,
  PluginCallback,
  PluginContext,
  PluginControls,
  PluginErrorSpec,
  PluginJobHandler,
  PluginMaintenanceTask,
  PluginPermission,
  PluginServicesContext,
  PluginSpaceCreate,
} from './plugin-extensions.js';
import type { ServerScope } from './server-config.js';
import type { TemplateDefinition } from './template-define.js';
import type { AnyFieldType } from './types.js';

export interface PluginHookRegistration<K extends keyof ManabloxHooks = keyof ManabloxHooks> {
  hook: K;
  handler: HookHandler<ManabloxHooks[K][0], ManabloxHooks[K][1]>;
  priority?: number;
}

/**
 * A `hooks` entry typed by its hook: the handler gets that hook's payload and context.
 * Handlers run lowest `priority` first, 100 by default.
 */
export function onHook<K extends keyof ManabloxHooks>(
  hook: K,
  handler: HookHandler<ManabloxHooks[K][0], ManabloxHooks[K][1]>,
  priority?: number,
): PluginHookRegistration {
  // One registration type holds every hook's handler.
  return (priority === undefined ? { hook, handler } : { hook, handler, priority }) as never;
}

/**
 * Server routes and middleware; typed by `@manablox/server`, which fills this in. `S` is the
 * plugin's services. See `pluginServer` there.
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by @manablox/server
// biome-ignore lint/correctness/noUnusedVariables: used by the augmentation
export interface PluginServer<S = unknown> {}

/** Where a plugin's admin bundle lives. */
export interface PluginAdmin {
  /** Absolute folder holding `manifest.json`, `entry.js` and its files (`dist/admin`). */
  dir?: string;
  /** Origins the admin frames; added to a restricted `server.csp.frameSrc`. */
  frameOrigins?: readonly string[];
}

/**
 * A server mode (`server.mode`, `manablox start --mode`); `@manablox/server` adds its
 * `surface`. See https://dev.manablox.io/extending/server-modes/.
 */
// biome-ignore lint/correctness/noUnusedVariables: used by the augmentation
export interface PluginServerMode<S = unknown> {
  name: string;
  /** Core scopes mounted next to the mode's surface when `server.scopes` is not set. */
  scopes: readonly ServerScope[];
}

/** What a plugin's `llms` section gets. */
export interface PluginLlmsContext<S = unknown> {
  /** The management API origin. */
  baseUrl: string;
  /** `/llms-full.txt` rather than `/llms.txt`. */
  complete: boolean;
  /** A procedure call as a Markdown HTTP example. */
  call(procedure: string, body: unknown): string;
  /** The plugin's context, with its services. */
  plugin: PluginContext<S>;
}

/** Tables a plugin owns; `@manablox/db` adds their definitions as `tables`. */
export interface PluginDatabase {
  /** Absolute migration folders per dialect, run after core's with their own journal. */
  migrations: { postgres: string; sqlite: string };
}

/**
 * Fields a plugin adds to a content type declared elsewhere: in the config or by another
 * plugin. A field that exists is merged (`settings` and `admin` key by key), so two plugins
 * touching one field keep both their settings. See https://dev.manablox.io/extending/plugins/.
 */
export interface ContentTypeExtension {
  /** The content type's name. */
  name: string;
  fields?: FieldInput[];
  icon?: string;
  label?: string;
}

/**
 * A plugin; `S` is what its `services` builds, any by default so typed plugins fit lists.
 * Fields are grouped below; other packages add some (`db.tables` by `@manablox/db`, `rpc` by
 * `@manablox/api-rpc`, ...). https://dev.manablox.io/extending/plugin-contract/ lists every field and where
 * it comes from.
 */
// biome-ignore lint/suspicious/noExplicitAny: plugins with different services share one list
export interface ManabloxPlugin<S = any> {
  // --- Identity and the plugin graph ------------------------------------------------------

  /** The plugin's name; its id (`pluginId`) names its flag `plugins.<id>`, keys and routes. */
  name: string;
  version?: string;
  description?: string;
  /**
   * Ids of plugins this one cannot run without: the server refuses to start when one is not
   * configured, and boots them first. See https://dev.manablox.io/extending/dependencies/.
   */
  requires?: string[];
  /**
   * Ids of plugins this one adds to when they are configured: booted first where that forms no
   * cycle; missing ones are fine.
   */
  enhances?: string[];
  /**
   * Points other plugins fill through their `contributions`, by name; the plugin reads them
   * with `plugin.contributions(name)`. See https://dev.manablox.io/extending/extension-points/.
   */
  // biome-ignore lint/suspicious/noExplicitAny: each point types its own entries
  extensionPoints?: Record<string, ExtensionPointSpec<any>>;
  /**
   * Entries for other plugins' extension points, by target plugin id, then point. Those for a
   * plugin that is not configured are skipped.
   */
  contributions?: PluginContributionMap;

  // --- Model: field and content types, block data, tables ---------------------------------

  fieldTypes?: AnyFieldType[];
  contentTypes?: ContentTypeInput[];
  /**
   * Fields for content types declared in the config or by other plugins, applied after every
   * plugin's `contentTypes`; a type that is not declared in code stops the boot
   * (`plugin.extend.contentType.notFound`). Not switched by the plugin's flag: the fields are
   * part of the type in every space.
   */
  extend?: ContentTypeExtension[];
  /** Checks this plugin's entry in `plugins` of code content types. */
  contentTypeData?: PluginContentTypeData;
  /** Data on block instances at `ext.<id>`; see https://dev.manablox.io/extending/block-extensions/. */
  blocks?: PluginBlocks;
  /** Tables and migrations; see https://dev.manablox.io/extending/plugins/. */
  db?: PluginDatabase;

  // --- Declarations: keys, resources in code ----------------------------------------------

  /** Permissions `<id>:<action>`; see https://dev.manablox.io/extending/permissions/. */
  permissions?: PluginPermission[];
  /** Control keys under `<kind>.plugins.<id>.*`; see https://dev.manablox.io/extending/controls/. */
  controls?: PluginControls;
  /**
   * Read-only feature values above every scope, never stored: a feature a ceiling has off is
   * off everywhere. Called once per process, in every mode, after the plugin's services are
   * built. See https://dev.manablox.io/extending/controls/#feature-ceilings.
   */
  ceilings?: PluginCallback<[plugin: PluginContext<S>], FeatureCeilingProvider>;
  /** Audit target kinds `<id>.<entity>`. */
  audit?: PluginAudit;
  /** Error keys `plugins.<id>.*`. */
  errors?: Record<PluginErrorKey, PluginErrorSpec>;
  /** Code resources for the targeted spaces, reconciled as `source: 'code'`. */
  credentials?: CredentialDefinition[];
  templates?: TemplateDefinition[];
  /** Code resource kinds the plugin owns, by `<id>.<name>`; see https://dev.manablox.io/extending/plugins/. */
  resourceKinds?: Record<string, PluginResourceKind>;
  /** Entries of plugin resource kinds, by kind; any plugin may add to any kind. */
  resources?: Record<string, PluginResourceEntry[]>;

  // --- Runtime: services, hooks, jobs, lifecycle ------------------------------------------

  /** Builds the plugin's services once per process; see https://dev.manablox.io/extending/services/. */
  services?: (context: PluginServicesContext) => S;
  /**
   * The plugin's hook handlers, made with `onHook`; each is skipped in spaces where the plugin's
   * flag is off. Called once at boot with the plugin's context, whose `services` the handlers
   * may read when they run. See https://dev.manablox.io/extending/hooks/.
   */
  hooks?: PluginCallback<[plugin: PluginContext<S>], PluginHookRegistration[]>;
  /** Job handlers by name, queued as `<id>:<name>`; see https://dev.manablox.io/extending/jobs/. */
  jobs?: Record<string, PluginJobHandler<S>>;
  /** Payload-less jobs the management worker runs on a schedule. */
  maintenance?: PluginMaintenanceTask<S>[];
  /**
   * Starts long-running work, such as timers or watchers, in the process that runs scheduled
   * work (`management` mode), once the server has booted. See https://dev.manablox.io/extending/lifecycle/.
   */
  start?: PluginCallback<[plugin: PluginContext<S>], void | Promise<void>>;
  /** Stops what `start` began when the server shuts down; plugins stop in reverse boot order. */
  stop?: PluginCallback<[plugin: PluginContext<S>], void | Promise<void>>;
  /** Applies the plugin's draft of a new space; see https://dev.manablox.io/extending/plugins/. */
  spaceCreate?: PluginSpaceCreate<S>;

  // --- Surfaces: HTTP, server modes, admin, LLM guide -------------------------------------

  /** HTTP routes under `/plugins/<id>/` and middleware, per server scope. */
  server?: PluginServer<S>;
  /** Server modes; see https://dev.manablox.io/extending/server-modes/. */
  modes?: PluginServerMode<S>[];
  /** The prebuilt admin bundle; the admin loads it at runtime. See https://dev.manablox.io/extending/admin-plugins/. */
  admin?: PluginAdmin;
  /** Markdown added to the management API's `/llms.txt` and `/llms-full.txt`. */
  llms?: PluginCallback<[context: PluginLlmsContext<S>], string>;
  /**
   * The module of the plugin's part of the `manablox` CLI, for a plugin without a package of
   * its own (kept in the instance's repository): a module id or a path relative to the config's
   * folder, an absolute path or a file URL. It wins over `"manablox": { "cli" }` in the
   * package's `package.json`, which a published plugin uses instead so its commands show in the
   * help without the config. See https://dev.manablox.io/extending/cli/.
   */
  cli?: string;

  // --- Data: the lifecycle of the plugin's rows -------------------------------------------

  /** Environments, transfers, snapshots, retention, limits; see https://dev.manablox.io/extending/data-providers/. */
  data?: PluginDataProvider[];
}

/** The plugin's id in its flag: the name lowercased, `@` dropped, `/` as `.`. */
export function pluginId(name: string): string {
  return name
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/\//g, '.')
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, 100);
}

/** The flag a plugin answers to: `plugins.<id>`. */
export function pluginFeatureKey(plugin: Pick<ManabloxPlugin, 'name'>): FeatureKey {
  return `plugins.${pluginId(plugin.name)}`;
}

export function definePlugin<S>(plugin: ManabloxPlugin<S>): ManabloxPlugin<S> {
  return plugin;
}
